// [LAW:dataflow-not-control-flow] Every publish attempt runs the same probe -> worktree -> render ->
//   commit -> push pipeline. Whether the target branch exists is *data* -- the commit's base
//   (parents + tree) -- never a condition that picks a different sequence of git operations.
// [LAW:single-enforcer] Git identity, remote authentication, and the meaning of every git exit code
//   live in exactly one place -- this module. No other code talks to `git` directly.
// [LAW:effects-at-boundaries] Deploy never writes the source repo's config, refs, or FETCH_HEAD, and
//   never puts the token in a command line: the remote's URL is credential-free and its auth header
//   reaches git only through the environment of each git process. A CLI run in the user's own clone
//   leaves their origin, identity, refs and credential store exactly as it found them.
// [LAW:no-silent-failure] Every git invocation either succeeds or throws. The only non-zero exits
//   that are not errors are the ones a command defines as an answer (ls-remote --exit-code, a
//   stale-tip push rejection), and each is mapped to a named outcome below.
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { DeploymentContext, GitConfig, Manifest, PlacementCounts, Remote, PageCopies, RenamedSlot, SlotPages, SlotRename, SourceRepo, WrapperCoverage } from './types.js';
import { renderIndexHtml, renderRedirectHtml, type RepoMeta } from './index-renderer.js';
import { injectWidgetIntoHtmlFiles } from './widget-injector.js';
import { rebaseUrls } from './base-path.js';
import { emptyPlacementCounts, addPlacementCounts, findHtmlFilesRelative, findSlotHtmlFiles } from './slot-pages.js';
import { renderRobotsTxt } from './robots-generator.js';
import { renderSitemapXml } from './sitemap-generator.js';
import { renderHealth, serializeHealth } from './health-generator.js';
import { renderStatsHtml } from './stats-renderer.js';
import { injectCanonicalTags, injectNoindexIntoDir } from './seo-injector.js';
import { placeStorageWrapperInSlot } from './storage-wrapper-injector.js';
import { autoNamespace } from './storage-wrapper.js';

// GIT_AUTHOR_*/GIT_COMMITTER_* outrank any user.name/user.email config, so a deploy commit's identity
// is this one even in a clone whose owner exports their own.
const DEPLOY_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'github-actions[bot]',
  GIT_AUTHOR_EMAIL: 'github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'github-actions[bot]',
  GIT_COMMITTER_EMAIL: 'github-actions[bot]@users.noreply.github.com',
};

/**
 * The GitHub remote for `owner/repo`, authenticated as actions/checkout does: a basic-auth header
 * scoped to github.com. The empty entries first reset what git has already read -- a header
 * actions/checkout persisted, a credential helper -- so this token is the only credential sent, and
 * a rejected token fails instead of falling back to (or being stored in) the user's own credentials.
 * The URL names the x-access-token user (not secret) so a `url.*.insteadOf`/`pushInsteadOf` rule for
 * https://github.com/ in the user's config -- commonly a rewrite to SSH -- cannot redirect the deploy
 * to another transport and credential.
 */
export function githubRemote(token: string, repo: string): Remote {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return {
    url: `https://x-access-token@github.com/${repo}.git`,
    config: [
      ['credential.helper', ''],
      ['http.https://github.com/.extraheader', ''],
      ['http.https://github.com/.extraheader', header],
    ],
  };
}

function gitFailure(args: string[], out: exec.ExecOutput): Error {
  return new Error(`git ${args.join(' ')} failed (exit ${out.exitCode}): ${out.stderr.trim()}`);
}

interface GitRun {
  config?: GitConfig; // appended after any GIT_CONFIG_COUNT entries already in the environment
  env?: Record<string, string>;
}

/**
 * The one way git is run. Silent, so a command line is never echoed to stdout; never prompts, since a
 * prompt nobody sees is a hang. `config` travels in GIT_CONFIG_* -- visible only to this process and
 * its children, unlike `-c` arguments, which any local user can read in the process table.
 */
function runGit(cwd: string, args: string[], { config = [], env = {} }: GitRun = {}): Promise<exec.ExecOutput> {
  const inherited = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  const configEnv = Object.fromEntries(
    config.flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${inherited + i}`, key], [`GIT_CONFIG_VALUE_${inherited + i}`, value]]),
  );
  return exec.getExecOutput('git', args, {
    cwd,
    ignoreReturnCode: true,
    silent: true,
    input: Buffer.alloc(0), // stdin closed: mktree reads its (empty) tree from it
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...configEnv, GIT_CONFIG_COUNT: String(inherited + config.length), ...env },
  });
}

/**
 * Run git in `cwd`. `answers` maps each exit code the command defines as an answer to its
 * outcome (ls-remote --exit-code: 2 = "no such ref"); any other exit code throws with git's stderr.
 */
async function gitAnswer<T>(cwd: string, args: string[], answers: Record<number, T>, run: GitRun = {}): Promise<{ answer: T; stdout: string }> {
  const out = await runGit(cwd, args, run);
  if (!(out.exitCode in answers)) throw gitFailure(args, out);
  return { answer: answers[out.exitCode], stdout: out.stdout.trim() };
}

/** Run git in `cwd` and return its trimmed stdout; any non-zero exit throws. */
async function git(cwd: string, args: string[], run: GitRun = {}): Promise<string> {
  const out = await runGit(cwd, args, run);
  if (out.exitCode !== 0) throw gitFailure(args, out);
  return out.stdout.trim();
}

/**
 * What a deploy commit is built on: the remote tip of the target branch, or nothing at all on the
 * first deploy -- no parents and the empty tree. The deploy commit is created detached from both
 * (commit-tree), so no local branch is ever created in the source repo.
 */
export interface CommitBase {
  parents: string[];
  tree: string;
}

/** A detached worktree whose index and files are exactly `base.tree`. */
export interface Worktree {
  path: string;
  base: CommitBase;
}

async function resolveBase(source: SourceRepo, targetBranch: string): Promise<CommitBase> {
  const { remote } = source;
  const ref = `refs/heads/${targetBranch}`;
  // ls-remote --exit-code answers "does the branch exist" with exit 2 for "no". A network or
  // auth failure is a different exit and throws, instead of masquerading as a first deploy.
  const probe = await gitAnswer(source.dir, ['ls-remote', '--exit-code', remote.url, ref], { 0: true, 2: false }, remote);
  if (!probe.answer) {
    core.info(`Target branch ${targetBranch} not found on remote; the first deploy creates it.`);
    return { parents: [], tree: await git(source.dir, ['mktree']) };
  }
  // The base is the tip ls-remote saw, fetched by id: no ref and no FETCH_HEAD in the source repo
  // is written or read, so nothing else touching the clone can change what the deploy builds on.
  // Full depth: a --depth=1 fetch can shallow the source repo, which breaks
  // metadata-extractor's `git log` over ranges that predate gh-pages history.
  const tip = probe.stdout.split('\t')[0];
  await git(source.dir, ['fetch', '--no-write-fetch-head', remote.url, tip], remote);
  return { parents: [tip], tree: await git(source.dir, ['rev-parse', `${tip}^{tree}`]) };
}

/**
 * Run `use` on a fresh worktree at the current remote tip of the target branch, then remove the
 * worktree whether `use` succeeded or not.
 * [LAW:no-ambient-temporal-coupling] The worktree's whole lifecycle -- create, populate, use,
 *   remove -- has this one owner, so no failure point can leak a registered worktree.
 */
export async function withWorktree<T>(
  source: SourceRepo,
  targetBranch: string,
  use: (worktree: Worktree) => Promise<T>,
): Promise<T> {
  const base = await resolveBase(source, targetBranch);
  const worktree: Worktree = { path: path.join(os.tmpdir(), `gh-pages-${randomUUID()}`), base };
  // --no-checkout leaves the index empty; read-tree then makes index and files exactly the base tree.
  await git(source.dir, ['worktree', 'add', '--detach', '--no-checkout', worktree.path, 'HEAD']);
  try {
    await git(worktree.path, ['read-tree', '-u', '--reset', base.tree]);
    return await use(worktree);
  } finally {
    // --force: an attempt can fail mid-render and leave changes behind. A cleanup failure is
    // logged and never masks the attempt's own error.
    await git(source.dir, ['worktree', 'remove', '--force', worktree.path]).catch((e: unknown) => {
      core.warning(`Worktree cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

/**
 * What happened to a deploy commit:
 * - `pushed`: the commit is now the remote tip.
 * - `unchanged`: the rendered tree matched the remote tip; nothing to commit.
 * - `stale`: someone else pushed first; the commit was built on an old tip and was
 *   rejected with `rejection`. The caller rebuilds from the new tip -- it is never rebased, because
 *   every derived file (index, sitemap, health, SEO tags) must be re-rendered from the new manifest.
 */
export type PushOutcome =
  | { kind: 'pushed' }
  | { kind: 'unchanged' }
  | { kind: 'stale'; rejection: string };

// `git push --porcelain` prints one "!<TAB><src>:<dst><TAB><status>" line per refused ref. A tip that
// moved before our push is "[rejected] (fetch first|non-fast-forward)"; a tip that moved *during* it
// loses the remote's compare-and-swap on the ref, which servers report as "[remote rejected]" with
// "incorrect old value provided", "reference already exists" (both sides creating the branch), or a
// lock failure naming the expected old value. Every other refusal -- a hook decline, a protected
// branch, a lock failure for any other reason -- is not a race and is not ours to retry.
const STALE_TIP_RE =
  /^!\t[^\t]+\t(\[rejected\] \((fetch first|non-fast-forward)\)|\[remote rejected\] \((incorrect old value provided|reference already exists|cannot lock ref '[^']+': (is at [0-9a-f]+ but expected [0-9a-f]+|reference already exists))\))$/m;

/** The porcelain line saying the push lost a race for the branch tip, or null if it lost no race. */
export function staleTipRejection(porcelain: string): string | null {
  return STALE_TIP_RE.exec(porcelain)?.[0] ?? null;
}

/**
 * Commit everything in the worktree as "Deploy <versionSlot>" on top of `worktree.base`, and push
 * it to targetBranch as a plain (non-force) push -- the remote accepts it only if its tip is still
 * the base. Any failure other than a stale tip throws.
 */
export async function commitAndPush(
  worktree: Worktree,
  context: DeploymentContext,
  remote: Remote,
  targetBranch: string,
): Promise<PushOutcome> {
  const wd = worktree.path;
  await git(wd, ['add', '-A']);
  const tree = await git(wd, ['write-tree']);
  if (tree === worktree.base.tree) return { kind: 'unchanged' };

  const parentArgs = worktree.base.parents.flatMap((p) => ['-p', p]);
  const commitArgs = ['commit-tree', tree, ...parentArgs, '-m', `Deploy ${context.versionSlot}`];
  const commit = await git(wd, commitArgs, { env: DEPLOY_IDENTITY });

  const args = ['push', '--porcelain', remote.url, `${commit}:refs/heads/${targetBranch}`];
  const push = await runGit(wd, args, remote);
  if (push.exitCode === 0) return { kind: 'pushed' };
  const rejection = staleTipRejection(push.stdout);
  if (rejection !== null) return { kind: 'stale', rejection };
  throw gitFailure(args, { ...push, stderr: `${push.stderr.trim()} ${push.stdout.trim()}` });
}

/**
 * Read the CNAME file from the worktree root. Returns the trimmed domain string
 * if it exists, or null if it does not. Used by the URL computation in index.ts
 * to produce a real URL for custom-domain deployments (avoids the placeholder trap).
 */
export async function readCnameFile(workdir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(workdir, 'CNAME'), 'utf8');
    return raw.trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Remove version directories from the worktree. Uses force: true for idempotency
 * (missing directories are silently ok). Returns count of directories removed.
 * [LAW:dataflow-not-control-flow] Always runs; empty list = zero removals in data.
 * [LAW:single-enforcer] Worktree I/O lives exclusively in this module.
 */
export async function removeVersionDirectories(workdir: string, versions: string[]): Promise<number> {
  let removed = 0;
  for (const slot of versions) {
    const target = path.join(workdir, slot);
    await rm(target, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * Move each renamed slot's directory to its new name, and rebase its pages: every URL its deploy wrote
 * under the old base path (a <base href>, or the prefix of rewritten URLs) moves under the base path
 * of the new slot. `siteRoot` is the URL path the gh-pages root is served from. A slot with no
 * directory has nothing to move. Returns each rename with the number of pages it rebased.
 * [LAW:dataflow-not-control-flow] Always runs; no renames = no moves in data.
 */
export async function renameVersionDirectories(workdir: string, siteRoot: string, renames: SlotRename[]): Promise<RenamedSlot[]> {
  const renamed: RenamedSlot[] = [];
  for (const { from, to } of renames) {
    const fromDir = path.join(workdir, from);
    let pages = 0;
    for (const file of await findSlotHtmlFiles(fromDir)) {
      const html = await readFile(file, 'utf8');
      const rebased = rebaseUrls(html, `${siteRoot}${from}/`, `${siteRoot}${to}/`);
      await writeFile(file, rebased, 'utf8');
      pages += Number(rebased !== html);
    }
    try {
      await rename(fromDir, path.join(workdir, to));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT' || e.path !== fromDir) {
        throw new Error(`Renaming slot "${from}" to its URL-safe slot name "${to}" failed: ${e.message}`, { cause: err });
      }
    }
    renamed.push({ from, to, pages });
  }
  return renamed;
}

// [LAW:single-enforcer] All writes to the gh-pages worktree live in this module.
// The rendered index is produced by the pure renderer in index-renderer.ts; this
// function is the sole I/O enforcer that lands it on disk.
// [LAW:dataflow-not-control-flow] Runs unconditionally on every deploy; empty
// manifest still produces a valid index.html (renderer handles empty-case in data).
export async function writeIndexHtml(
  workdir: string,
  manifest: Manifest,
  repoMeta: RepoMeta,
): Promise<void> {
  // Root index.html redirects to the latest non-PR version.
  const redirectHtml = renderRedirectHtml(manifest);
  await writeFile(path.join(workdir, 'index.html'), redirectHtml, 'utf8');

  // Version listing lives at _versions/index.html — still accessible, just not the root.
  const versionsDir = path.join(workdir, '_versions');
  await mkdir(versionsDir, { recursive: true });
  const listingHtml = renderIndexHtml(manifest, repoMeta);
  await writeFile(path.join(versionsDir, 'index.html'), listingHtml, 'utf8');
}

// [LAW:single-enforcer] All writes to the gh-pages worktree live in this module.
// The widget script is generated by the pure helper in widget-injector.ts; this
// function is the sole I/O enforcer that lands the script tag in deployed HTML files.
// [LAW:one-source-of-truth] Every slot is re-placed on every deploy, so each slot's pages carry the
// widget this deploy renders, not the one current when that slot was last deployed. The widget's
// links are the layout this module writes, under siteRoot (the URL path gh-pages is served from).
export interface WidgetCustomization {
  icon: string;     // empty string means use default
  label: string;    // empty string means use default
  position: string; // empty string means use default
  color: string;    // empty string means use default
}

export async function injectWidgetIntoSlots(
  workdir: string,
  siteRoot: string,
  slots: string[],
  customization: WidgetCustomization,
): Promise<PlacementCounts> {
  const total = emptyPlacementCounts();
  for (const slot of slots) {
    addPlacementCounts(total, await injectWidgetIntoHtmlFiles(path.join(workdir, slot), {
      siteRoot,
      manifestPath: 'versions.json',
      indexPath: '_versions/',
      currentVersion: slot,
      ...customization,
    }));
  }
  return total;
}

export interface SlotWrapperCoverage {
  slot: string;
  coverage: WrapperCoverage;
}

/**
 * Place the current storage wrapper in each listed slot. The wrapper installs a Proxy around
 * window.localStorage and window.sessionStorage that prefixes every key with a namespace: the one a
 * page's wrapper already carries, or `gh-pm:<owner>/<repo>/<slot>:` for a page wrapped now.
 */
export async function placeStorageWrapperInSlots(
  workdir: string,
  repoMeta: RepoMeta,
  slots: SlotWrapperCoverage[],
): Promise<PlacementCounts> {
  const total = emptyPlacementCounts();
  for (const { slot, coverage } of slots) {
    const opts = { namespace: autoNamespace(repoMeta.owner, repoMeta.repo, slot) };
    addPlacementCounts(total, await placeStorageWrapperInSlot(path.join(workdir, slot), opts, coverage));
  }
  return total;
}

// ---- SEO / health / stats writers ------------------------------------------
// [LAW:single-enforcer] All writes to the gh-pages worktree live in this module.
// The pure renderers / injectors produce content; these wrappers land it on disk.

/**
 * Write robots.txt at the worktree root. Disallows crawlers from every PR
 * preview directory currently in the manifest.
 */
export async function writeRobotsTxt(
  workdir: string,
  manifest: Manifest,
  siteRoot: string,
): Promise<void> {
  const txt = renderRobotsTxt(manifest, siteRoot);
  await writeFile(path.join(workdir, 'robots.txt'), txt, 'utf8');
}

/**
 * The pages of each slot in `slots`, in the given order. A slot with no directory has no pages.
 */
export async function readSlotPages(workdir: string, slots: readonly string[]): Promise<SlotPages[]> {
  return Promise.all(slots.map(async (slot) => ({ slot, pages: await findHtmlFilesRelative(path.join(workdir, slot)) })));
}

/**
 * Write sitemap.xml at the worktree root, listing the canonical copy of every page in `copies`.
 * No non-PR version means no copies and an empty urlset.
 */
export async function writeSitemapXml(
  workdir: string,
  copies: readonly PageCopies[],
  baseUrl: string,
  lastmod: string,
): Promise<void> {
  await writeFile(path.join(workdir, 'sitemap.xml'), renderSitemapXml(baseUrl, copies, lastmod), 'utf8');
}

/**
 * Write _health.json at the worktree root. Pure projection of the manifest +
 * deploy timestamp. Used by external uptime monitors.
 */
export async function writeHealthJson(
  workdir: string,
  manifest: Manifest,
  generatedAt: string,
): Promise<void> {
  const record = renderHealth(manifest, generatedAt);
  await writeFile(path.join(workdir, '_health.json'), serializeHealth(record), 'utf8');
}

/**
 * Write the client-side stats dashboard at _versions/stats.html. The rendered
 * page is static HTML + inline JS that fetches versions.json at runtime.
 */
export async function writeStatsHtml(
  workdir: string,
  repoMeta: RepoMeta,
): Promise<void> {
  const versionsDir = path.join(workdir, '_versions');
  await mkdir(versionsDir, { recursive: true });
  const html = renderStatsHtml(repoMeta);
  await writeFile(path.join(versionsDir, 'stats.html'), html, 'utf8');
}

/**
 * Inject/update canonical URLs on every copy of every page in `copies`, pointing at the page's
 * canonical copy (see groupPageCopies). For the current PR directory, inject noindex instead.
 * `siteBase` is the absolute site URL (e.g., "https://example.com/repo"); `currentPrSlot` is null
 * when the current deploy is non-PR.
 */
export async function applySeoTags(
  workdir: string,
  copies: readonly PageCopies[],
  siteBase: string,
  currentPrSlot: string | null,
): Promise<{ canonicalCount: number; noindexCount: number }> {
  // [LAW:dataflow-not-control-flow] No non-PR version means no copies; the walk finishes with 0.
  const canonicalCount = await injectCanonicalTags(workdir, siteBase, copies);
  let noindexCount = 0;
  if (currentPrSlot !== null) {
    const prDir = path.join(workdir, currentPrSlot);
    noindexCount = await injectNoindexIntoDir(prDir);
  }
  return { canonicalCount, noindexCount };
}
