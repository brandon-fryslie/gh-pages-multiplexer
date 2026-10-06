// [LAW:dataflow-not-control-flow] prepareBranch always runs the same configure -> probe -> worktree-add
//   pipeline. Whether the target branch exists is *data* (the ls-remote outcome) that picks which
//   worktree-add variant runs, not a condition that skips operations.
// [LAW:single-enforcer] Git identity, remote URL configuration (with token), and the meaning of every
//   git exit code live in exactly one place -- this module. No other code talks to `git` directly.
// [LAW:no-silent-failure] Every git invocation either succeeds or throws. The only non-zero exits
//   that are not errors are the ones a command defines as an answer (diff --quiet, ls-remote
//   --exit-code, a stale-tip push rejection), and each is mapped to a named outcome below.
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Run git in `cwd`. `answers` maps each exit code the command defines as an answer to its
 * outcome (diff --quiet: 1 = "has changes"); any other exit code throws with git's stderr.
 */
async function gitAnswer<T>(cwd: string, args: string[], answers: Record<number, T>): Promise<T> {
  const out = await exec.getExecOutput('git', args, { cwd, ignoreReturnCode: true });
  if (!(out.exitCode in answers)) {
    throw new Error(`git ${args[0]} failed (exit ${out.exitCode}): ${out.stderr.trim()}`);
  }
  return answers[out.exitCode];
}

/** Run git in `cwd`; any non-zero exit throws. */
async function git(cwd: string, args: string[]): Promise<void> {
  await gitAnswer(cwd, args, { 0: undefined });
}

/** Authenticated HTTPS remote for a GitHub `owner/repo`. */
export function githubRemoteUrl(token: string, repo: string): string {
  // Actions log masking + core.setSecret on token mitigates T-01-08.
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

/** A worktree checked out at the remote tip of the target branch (or an empty orphan). */
export interface Worktree {
  repoDir: string; // the source repository that owns the worktree registration
  path: string;
}

/**
 * Prepare a git worktree at the current remote tip of the target branch, or an
 * empty orphan worktree when the branch does not exist yet (first deploy).
 */
export async function prepareBranch(source: SourceRepo, targetBranch: string): Promise<Worktree> {
  const repoDir = source.dir;
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'gh-pages-'));

  // Configure git identity and authenticated remote URL. [LAW:single-enforcer]
  await git(repoDir, ['config', 'user.name', GIT_USER_NAME]);
  await git(repoDir, ['config', 'user.email', GIT_USER_EMAIL]);
  await git(repoDir, ['remote', 'set-url', 'origin', source.remoteUrl]);

  // ls-remote --exit-code answers "does the branch exist" with exit 2 for "no". A network or
  // auth failure is a different exit and throws, instead of masquerading as a first deploy.
  const branchExists = await gitAnswer(
    repoDir,
    ['ls-remote', '--exit-code', '--heads', 'origin', targetBranch],
    { 0: true, 2: false },
  );

  if (branchExists) {
    // Full depth: a --depth=1 fetch can shallow the source repo, which breaks
    // metadata-extractor's `git log` over ranges that predate gh-pages history.
    // Explicit refspec so the tracking ref updates regardless of the remote's fetch config.
    await git(repoDir, ['fetch', 'origin', `+refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`]);
    await git(repoDir, ['worktree', 'add', '--detach', workdir, `origin/${targetBranch}`]);
  } else {
    core.info(`Target branch ${targetBranch} not found on remote; creating orphan branch.`);
    await git(repoDir, ['worktree', 'add', '--detach', workdir]);
    await git(workdir, ['checkout', '--orphan', targetBranch]);
    await git(workdir, ['rm', '-rf', '--quiet', '.']);
  }

  return { repoDir, path: workdir };
}

/**
 * What happened to a deploy commit:
 * - `pushed`: the commit is now the remote tip.
 * - `unchanged`: the worktree matched the remote tip; nothing to commit.
 * - `stale`: someone else pushed first; the commit was built on an old tip and was
 *   rejected. The caller rebuilds from the new tip -- it is never rebased, because every
 *   derived file (index, sitemap, health, SEO tags) must be re-rendered from the new manifest.
 */
export type PushOutcome = 'pushed' | 'unchanged' | 'stale';

// `git push --porcelain` prints one "!<TAB><src>:<dst><TAB><status>" line per refused ref. A tip that
// moved before our push is "[rejected] (fetch first|non-fast-forward)"; a tip that moved *during* it
// loses the remote's compare-and-swap on the ref, which servers report as "[remote rejected]" with
// "incorrect old value provided", "reference already exists" (both sides creating the branch),
// "cannot lock ref ...", or "failed to update ref". Every other
// refusal (a hook decline, a protected branch) is not ours to retry.
const STALE_TIP_RE =
  /^!\t[^\t]+\t(\[rejected\] \((fetch first|non-fast-forward)\)|\[remote rejected\] \((incorrect old value provided|reference already exists|cannot lock ref|failed to update ref)\b.*\))$/m;

/**
 * Stage everything in the worktree, commit as "Deploy <versionSlot>", and push to
 * targetBranch as a plain (non-force) push -- the remote accepts it only if its tip is
 * still the one this worktree was built on. Any failure other than a stale tip throws.
 */
export async function commitAndPush(
  worktree: Worktree,
  context: DeploymentContext,
  targetBranch: string,
): Promise<PushOutcome> {
  const wd = worktree.path;
  await git(wd, ['add', '-A']);

  const staged = await gitAnswer(wd, ['diff', '--cached', '--quiet'], { 0: false, 1: true });
  if (!staged) return 'unchanged';

  await git(wd, ['commit', '--quiet', '-m', `Deploy ${context.versionSlot}`]);

  const push = await exec.getExecOutput(
    'git',
    ['push', '--porcelain', 'origin', `HEAD:refs/heads/${targetBranch}`],
    { cwd: wd, ignoreReturnCode: true },
  );
  if (push.exitCode === 0) return 'pushed';
  if (STALE_TIP_RE.test(push.stdout)) return 'stale';
  throw new Error(`git push failed (exit ${push.exitCode}): ${push.stderr.trim()} ${push.stdout.trim()}`);
}

/**
 * Remove the worktree directory. Uses --force to clean up even if the worktree
 * has uncommitted changes (an attempt can fail mid-render).
 */
export async function cleanupWorktree(worktree: Worktree): Promise<void> {
  await git(worktree.repoDir, ['worktree', 'remove', '--force', worktree.path]);
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
