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
import { readFile, writeFile } from 'node:fs/promises';
import type { DeployConfig, DeploymentContext, Manifest } from './types.js';
import { renderIndexHtml, type RepoMeta } from './index-renderer.js';
import { injectWidgetIntoHtmlFiles } from './widget-injector.js';

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

  // Fetch target branch (shallow). Exit code tells us if the branch exists.
  const fetchCode = await git(['fetch', 'origin', config.targetBranch, '--depth=1']);

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
  const html = renderIndexHtml(manifest, repoMeta);
  await writeFile(path.join(workdir, 'index.html'), html, 'utf8');
}

// [LAW:single-enforcer] All writes to the gh-pages worktree live in this module.
// The widget script is generated by the pure helper in widget-injector.ts; this
// function is the sole I/O enforcer that lands the script tag in deployed HTML files.
// [LAW:dataflow-not-control-flow] Runs unconditionally on every deploy. Empty html
// list returns 0 from the underlying walker -- no guarded skip. The relative URLs
// are derived purely from versionSlot ([LAW:one-source-of-truth]).
export async function injectWidgetForVersion(
  workdir: string,
  versionSlot: string,
  _repoMeta: RepoMeta,
): Promise<number> {
  const versionDir = path.join(workdir, versionSlot);
  return injectWidgetIntoHtmlFiles(versionDir, {
    manifestUrl: '../versions.json',
    indexUrl: '../',
    currentVersion: versionSlot,
  });
}
