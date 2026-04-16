// [LAW:dataflow-not-control-flow] prepareBranch always runs the same configure -> fetch -> worktree-add
//   pipeline. The fetch exit code is *data* that decides which worktree-add variant is invoked,
//   not a condition that skips operations. commitAndPush similarly runs a fixed add/diff/commit/push
//   sequence each attempt; retries are a bounded loop, not conditional side effects.
// [LAW:single-enforcer] Git identity, remote URL configuration (with token), and push-retry policy
//   live in exactly one place -- this module. No other code talks to `git` directly.
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { DeployConfig, DeploymentContext, Manifest } from './types.js';
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

async function git(args: string[], opts: exec.ExecOptions = {}): Promise<number> {
  return exec.exec('git', args, { ignoreReturnCode: true, ...opts });
}

/**
 * Prepare a git worktree for the target branch. Fetches the branch if it exists,
 * otherwise creates an orphan branch for first-time deploys.
 * Returns the absolute path to the worktree.
 */
export async function prepareBranch(config: DeployConfig): Promise<string> {
  const workdir = path.join(os.tmpdir(), `gh-pages-${Date.now()}`);

  // Configure git identity and authenticated remote URL. [LAW:single-enforcer]
  await git(['config', 'user.name', GIT_USER_NAME]);
  await git(['config', 'user.email', GIT_USER_EMAIL]);
  // Embed token in remote URL. Actions log masking + core.setSecret on token mitigates T-01-08.
  const remoteUrl = `https://x-access-token:${config.token}@github.com/${config.repo}.git`;
  await git(['remote', 'set-url', 'origin', remoteUrl]);

  // Fetch target branch. Full depth: a --depth=1 fetch can shallow the source repo,
  // which breaks metadata-extractor's `git log` over ranges that predate gh-pages history.
  // gh-pages branches are small; the full fetch is fine.
  const fetchCode = await git(['fetch', 'origin', config.targetBranch]);

  if (fetchCode === 0) {
    // Branch exists: create a worktree pointing at the remote tip.
    await git(['worktree', 'add', workdir, `origin/${config.targetBranch}`]);
  } else {
    // First-time deploy: create an orphan branch inside a detached worktree.
    core.info(`Target branch ${config.targetBranch} not found on remote; creating orphan branch.`);
    await git(['worktree', 'add', '--detach', workdir]);
    await git(['-C', workdir, 'checkout', '--orphan', config.targetBranch]);
    await git(['-C', workdir, 'rm', '-rf', '.']);
  }

  return workdir;
}

/**
 * Stage all changes in workdir, commit as "Deploy <versionSlot>", and push to
 * targetBranch. On push failure, fetch+rebase and retry up to maxRetries times (DEPL-05).
 * No-op (idempotent) if there are no staged changes.
 */
export async function commitAndPush(
  workdir: string,
  context: DeploymentContext,
  targetBranch: string,
  maxRetries = 3,
): Promise<void> {
  await git(['-C', workdir, 'add', '-A']);

  // diff --cached --quiet exits 0 when there are NO staged changes.
  const diffCode = await git(['-C', workdir, 'diff', '--cached', '--quiet']);
  if (diffCode === 0) {
    core.info('No changes to deploy');
    return;
  }

  await git(['-C', workdir, 'commit', '-m', `Deploy ${context.versionSlot}`]);

  // Bounded retry loop. [LAW:dataflow-not-control-flow] same ops per attempt; attempt index is data.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const pushCode = await git(['-C', workdir, 'push', 'origin', `HEAD:${targetBranch}`]);
    if (pushCode === 0) return;

    if (attempt < maxRetries) {
      core.warning(`push attempt ${attempt} failed; fetching + rebasing and retrying`);
      await git(['-C', workdir, 'fetch', 'origin', targetBranch, '--depth=1']);
      await git(['-C', workdir, 'rebase', `origin/${targetBranch}`]);
    }
  }

  throw new Error(`Failed to push ${context.versionSlot} to ${targetBranch} after ${maxRetries} attempts`);
}

/**
 * Remove the worktree directory. Uses --force to clean up even if the worktree
 * has untracked changes (it always will -- we just committed).
 */
export async function cleanupWorktree(workdir: string): Promise<void> {
  await git(['worktree', 'remove', workdir, '--force']);
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
