// [LAW:dataflow-not-control-flow] Every publish attempt runs the same probe -> worktree -> render ->
//   commit -> push pipeline. Whether the target branch exists is *data* -- the commit's base
//   (parents + tree) -- never a condition that picks a different sequence of git operations.
// [LAW:single-enforcer] Git identity, the authenticated remote URL, and the meaning of every git exit
//   code live in exactly one place -- this module. No other code talks to `git` directly.
// [LAW:effects-at-boundaries] Deploy never writes the source repo's config: the remote URL is an
//   argument to ls-remote/fetch/push and the commit identity a -c on commit-tree, so a CLI run in the
//   user's own clone leaves their origin and identity exactly as it found them.
// [LAW:no-silent-failure] Every git invocation either succeeds or throws. The only non-zero exits
//   that are not errors are the ones a command defines as an answer (ls-remote --exit-code, a
//   stale-tip push rejection), and each is mapped to a named outcome below.
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { DeploymentContext, Manifest, SourceRepo } from './types.js';
import { renderIndexHtml, renderRedirectHtml, type RepoMeta } from './index-renderer.js';
import { injectWidgetIntoHtmlFiles } from './widget-injector.js';
import { renderRobotsTxt } from './robots-generator.js';
import {
  findHtmlFilesRelative,
  latestNonPrSlot,
  renderEmptySitemap,
  renderSitemapXml,
} from './sitemap-generator.js';
import { renderHealth, serializeHealth } from './health-generator.js';
import { renderStatsHtml } from './stats-renderer.js';
import { injectCanonicalIntoDir, injectNoindexIntoDir } from './seo-injector.js';
import { injectStorageWrapperIntoDir } from './storage-wrapper-injector.js';
import { autoNamespace } from './storage-wrapper.js';

const GIT_USER_NAME = 'github-actions[bot]';
const GIT_USER_EMAIL = 'github-actions[bot]@users.noreply.github.com';

/** Error text for a failed git command; the credential in an authenticated URL is redacted. */
function gitFailure(args: string[], out: exec.ExecOutput): Error {
  const message = `git ${args.join(' ')} failed (exit ${out.exitCode}): ${out.stderr.trim()}`;
  return new Error(message.replace(/\/\/[^/@\s]+@/g, '//***@'));
}

/**
 * The one way git is run. Silent: @actions/exec otherwise echoes every command line to stdout, and
 * an authenticated URL's token with it -- outside Actions nothing masks that line.
 */
function runGit(cwd: string, args: string[], input = ''): Promise<exec.ExecOutput> {
  return exec.getExecOutput('git', args, { cwd, ignoreReturnCode: true, silent: true, input: Buffer.from(input) });
}

/**
 * Run git in `cwd`. `answers` maps each exit code the command defines as an answer to its
 * outcome (ls-remote --exit-code: 2 = "no such ref"); any other exit code throws with git's stderr.
 */
async function gitAnswer<T>(cwd: string, args: string[], answers: Record<number, T>): Promise<T> {
  const out = await runGit(cwd, args);
  if (!(out.exitCode in answers)) throw gitFailure(args, out);
  return answers[out.exitCode];
}

/** Run git in `cwd` and return its trimmed stdout; any non-zero exit throws. */
async function git(cwd: string, args: string[], input = ''): Promise<string> {
  const out = await runGit(cwd, args, input);
  if (out.exitCode !== 0) throw gitFailure(args, out);
  return out.stdout.trim();
}

/** Authenticated HTTPS remote for a GitHub `owner/repo`. */
export function githubRemoteUrl(token: string, repo: string): string {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
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
  const ref = `refs/heads/${targetBranch}`;
  // ls-remote --exit-code answers "does the branch exist" with exit 2 for "no". A network or
  // auth failure is a different exit and throws, instead of masquerading as a first deploy.
  const exists = await gitAnswer(source.dir, ['ls-remote', '--exit-code', source.remoteUrl, ref], { 0: true, 2: false });
  if (!exists) {
    core.info(`Target branch ${targetBranch} not found on remote; the first deploy creates it.`);
    return { parents: [], tree: await git(source.dir, ['mktree']) };
  }
  // Full depth: a --depth=1 fetch can shallow the source repo, which breaks
  // metadata-extractor's `git log` over ranges that predate gh-pages history.
  // No destination ref: the tip is read from FETCH_HEAD, so no ref in the source repo is written.
  await git(source.dir, ['fetch', source.remoteUrl, ref]);
  const tip = await git(source.dir, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
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
  remoteUrl: string,
  targetBranch: string,
): Promise<PushOutcome> {
  const wd = worktree.path;
  await git(wd, ['add', '-A']);
  const tree = await git(wd, ['write-tree']);
  if (tree === worktree.base.tree) return { kind: 'unchanged' };

  const parentArgs = worktree.base.parents.flatMap((p) => ['-p', p]);
  const identity = ['-c', `user.name=${GIT_USER_NAME}`, '-c', `user.email=${GIT_USER_EMAIL}`];
  const commit = await git(wd, [...identity, 'commit-tree', tree, ...parentArgs, '-m', `Deploy ${context.versionSlot}`]);

  const args = ['push', '--porcelain', remoteUrl, `${commit}:refs/heads/${targetBranch}`];
  const push = await runGit(wd, args);
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
// [LAW:dataflow-not-control-flow] Runs unconditionally on every deploy. Empty html
// list returns 0 from the underlying walker -- no guarded skip. The relative URLs
// are derived purely from versionSlot ([LAW:one-source-of-truth]).
export interface WidgetCustomization {
  icon: string;     // empty string means use default
  label: string;    // empty string means use default
  position: string; // empty string means use default
  color: string;    // empty string means use default
}

export async function injectWidgetForVersion(
  workdir: string,
  versionSlot: string,
  _repoMeta: RepoMeta,
  customization: WidgetCustomization,
): Promise<number> {
  const versionDir = path.join(workdir, versionSlot);
  return injectWidgetIntoHtmlFiles(versionDir, {
    manifestUrl: '../versions.json',
    indexUrl: '../_versions/',
    currentVersion: versionSlot,
    icon: customization.icon,
    label: customization.label,
    position: customization.position,
    color: customization.color,
  });
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
 * Write sitemap.xml at the worktree root. URLs point at the latest non-PR
 * version's HTML files. If no non-PR version exists, an empty urlset is emitted.
 */
export async function writeSitemapXml(
  workdir: string,
  manifest: Manifest,
  baseUrl: string,
  lastmod: string,
): Promise<void> {
  const slot = latestNonPrSlot(manifest);
  let xml: string;
  if (slot === null) {
    xml = renderEmptySitemap();
  } else {
    const relPaths = await findHtmlFilesRelative(path.join(workdir, slot));
    xml = renderSitemapXml(baseUrl, slot, relPaths, lastmod);
  }
  await writeFile(path.join(workdir, 'sitemap.xml'), xml, 'utf8');
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
 * Inject/update canonical URLs into every non-PR version directory, pointing at
 * the latest non-PR version's equivalent path. For PR directories, inject
 * noindex instead. The `latestNonPrSiteBase` is the absolute URL base for the
 * latest non-PR version (e.g., "https://example.com/v2.0.0").
 *
 * Data-driven: caller decides which directories to process via `nonPrSlots`
 * and which PR directory to noindex via `currentPrSlot` (null when current
 * deploy is non-PR).
 */
/**
 * Inject the storage-wrapper script into every HTML file in a version directory.
 * The wrapper runs synchronously at page load and installs a Proxy around
 * window.localStorage and window.sessionStorage that transparently prefixes all
 * keys with `gh-pm:<owner>/<repo>/<version>:`.
 *
 * Enabled-as-data: when `enabled` is false, this is a zero-work no-op. No branching
 * in the caller.
 */
export async function injectStorageWrapperForVersion(
  workdir: string,
  versionSlot: string,
  repoMeta: RepoMeta,
  enabled: boolean,
): Promise<number> {
  const versionDir = path.join(workdir, versionSlot);
  const opts = enabled
    ? { namespace: autoNamespace(repoMeta.owner, repoMeta.repo, versionSlot) }
    : undefined;
  return injectStorageWrapperIntoDir(versionDir, opts);
}

export async function applySeoTags(
  workdir: string,
  nonPrSlots: string[],
  latestNonPrSiteBase: string | null,
  currentPrSlot: string | null,
): Promise<{ canonicalCount: number; noindexCount: number }> {
  let canonicalCount = 0;
  // [LAW:dataflow-not-control-flow] When latestNonPrSiteBase is null, nonPrSlots
  //   should be empty (caller ensures); loop trivially finishes with 0.
  if (latestNonPrSiteBase !== null) {
    for (const slot of nonPrSlots) {
      const versionDir = path.join(workdir, slot);
      canonicalCount += await injectCanonicalIntoDir(versionDir, latestNonPrSiteBase);
    }
  }
  let noindexCount = 0;
  if (currentPrSlot !== null) {
    const prDir = path.join(workdir, currentPrSlot);
    noindexCount = await injectNoindexIntoDir(prDir);
  }
  return { canonicalCount, noindexCount };
}
