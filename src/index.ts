// [LAW:dataflow-not-control-flow] The deploy pipeline runs the same 5 stages in the same order
//   every invocation. Variability (first-time branch vs existing, redeploy vs new version,
//   custom domain vs project site) lives in the data flowing through the stages -- never in
//   whether a stage executes.
// [LAW:single-enforcer] The Action adapter is the single wiring point between @actions/core I/O
//   and the shared deploy() pipeline. Pipeline internals live in src/deploy.ts.
// [LAW:one-type-per-behavior] Action and CLI (Plan 05-02) adapters share one deploy()
//   implementation. This file differs from src/cli.ts ONLY in how it gathers DeployConfig.
// [LAW:variability-at-edges] Pipeline core stays fixed; adapters handle CI-specific quirks.
import * as core from '@actions/core';
import * as github from '@actions/github';
import type { DeployConfig } from './types.js';
import { deploy } from './deploy.js';
import { upsertPreviewComment } from './pr-commenter.js';
import { resolveCleanupVersions } from './pr-cleanup.js';
import { fetchReleaseForRef } from './release-fetcher.js';
import { parseWidgetPosition, validateWidgetColor } from './widget-config.js';

// [LAW:verifiable-goals] parseInputs is exported so __tests__/inputs.test.ts
// can validate GHUB-02 contract directly.
export function parseInputs(): DeployConfig {
  const refPatterns = core
    .getInput('ref-patterns')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const basePathMode = core.getInput('base-path-mode');
  if (basePathMode !== 'base-tag' && basePathMode !== 'rewrite' && basePathMode !== 'none') {
    throw new Error(
      `Invalid base-path-mode: "${basePathMode}". Must be "base-tag", "rewrite", or "none".`,
    );
  }

  // Widget customization — validate up front so the action fails fast on bad input
  // instead of producing a broken widget at deploy time.
  const widgetPosition = core.getInput('widget-position');
  if (widgetPosition.length > 0) {
    parseWidgetPosition(widgetPosition); // throws on invalid; result is reparsed by widget-injector
  }
  const widgetColor = validateWidgetColor(core.getInput('widget-color'));

  return {
    sourceDir: core.getInput('source-dir', { required: true }),
    targetBranch: core.getInput('target-branch'),
    refPatterns,
    basePathMode,
    basePathPrefix: core.getInput('base-path-prefix'),
    token: core.getInput('token'),
    repo: process.env.GITHUB_REPOSITORY ?? '',
    ref: process.env.GITHUB_REF ?? '',
    version: core.getInput('version'),
    widgetIcon: core.getInput('widget-icon'),
    widgetLabel: core.getInput('widget-label'),
    widgetPosition,
    widgetColor,
    prBaseRef: process.env.GITHUB_BASE_REF ?? '',  // set by GitHub on PR events; empty otherwise
    cleanupVersions: [],  // populated below in run() after GitHub API query
    namespaceStorage: core.getInput('namespace-storage').trim().toLowerCase() === 'true',
  };
}

async function run(): Promise<void> {
  // [LAW:one-source-of-truth] D-10: git log runs against the source repo, never the gh-pages worktree.
  const sourceRepoDir = process.cwd();
  const config = parseInputs();
  core.info(`Deploying from ${config.sourceDir} to ${config.targetBranch}`);
  core.info(`Ref: ${config.ref}, Repo: ${config.repo}`);

  // [LAW:one-source-of-truth] Single octokit instance shared by cleanup and PR comment.
  const hasRepoSlug = config.repo.includes('/');
  const [owner, repo] = hasRepoSlug ? config.repo.split('/') : ['', ''];
  const octokit = hasRepoSlug ? github.getOctokit(config.token) : null;

  // Resolve stale PR versions before deploy. Cleanup failure must never block deploy.
  // [LAW:dataflow-not-control-flow] resolveCleanupVersions always runs; when octokit is
  //   absent or the query fails, it produces an empty list — same data shape either way.
  if (octokit) {
    try {
      config.cleanupVersions = await resolveCleanupVersions(octokit, owner, repo, config.targetBranch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`Cleanup resolution failed: ${msg}. Proceeding without cleanup.`);
    }

    // Look up GitHub Release metadata for tag refs. Non-tag refs and tags without
    // a release produce undefined (no-op in the pipeline).
    try {
      const release = await fetchReleaseForRef(octokit, owner, repo, config.ref);
      if (release) config.release = release;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`Release lookup failed: ${msg}. Proceeding without release metadata.`);
    }
  }

  const result = await deploy(config, sourceRepoDir);

  core.setOutput('version', result.version);
  core.setOutput('url', result.url);
  core.info(`Deployed ${result.version} to ${result.url}`);
  if (result.removedVersions.length > 0) {
    core.info(`Cleaned up ${result.removedVersions.length} stale PR version(s): ${result.removedVersions.join(', ')}`);
  }

  // [LAW:dataflow-not-control-flow] PR eligibility is data: we always reach the same call
  //   shape; the variability is whether `pr` is present. The deploy itself ran unconditionally.
  // [LAW:no-defensive-null-guards] exception: D-19 — the PR preview comment is optional and the
  //   deploy has already succeeded. This outer try/catch is the SINGLE documented swallow boundary
  //   in src/index.ts. Failure here MUST NOT fail the workflow.
  const ctx = github.context;
  const isPrEvent = ctx.eventName === 'pull_request' || ctx.eventName === 'pull_request_target';
  const pr = isPrEvent ? ctx.payload.pull_request : undefined;
  if (pr && typeof pr.number === 'number' && octokit) {
    try {
      await upsertPreviewComment(octokit, {
        owner,
        repo,
        prNumber: pr.number,
        previewUrl: result.url,
        version: result.version,
      });
      core.info(`Updated PR #${pr.number} preview comment`);
    } catch (err) {
      // [LAW:no-defensive-null-guards] exception: D-19 — documented swallow boundary.
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`PR preview comment failed: ${msg}. Deploy itself succeeded.`);
    }
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
