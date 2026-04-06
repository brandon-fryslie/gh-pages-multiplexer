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
import type { DeployConfig } from './types.js';
import { deploy } from './deploy.js';

// [LAW:verifiable-goals] parseInputs is exported so __tests__/inputs.test.ts
// can validate GHUB-02 contract directly.
export function parseInputs(): DeployConfig {
  const refPatterns = core
    .getInput('ref-patterns')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const basePathMode = core.getInput('base-path-mode');
  if (basePathMode !== 'base-tag' && basePathMode !== 'rewrite') {
    throw new Error(
      `Invalid base-path-mode: "${basePathMode}". Must be "base-tag" or "rewrite".`,
    );
  }

  return {
    sourceDir: core.getInput('source-dir', { required: true }),
    targetBranch: core.getInput('target-branch'),
    refPatterns,
    basePathMode,
    basePathPrefix: core.getInput('base-path-prefix'),
    token: core.getInput('token'),
    repo: process.env.GITHUB_REPOSITORY ?? '',
    ref: process.env.GITHUB_REF ?? '',
  };
}

async function run(): Promise<void> {
  // [LAW:one-source-of-truth] D-10: git log runs against the source repo, never the gh-pages worktree.
  const sourceRepoDir = process.cwd();
  const config = parseInputs();
  core.info(`Deploying from ${config.sourceDir} to ${config.targetBranch}`);
  core.info(`Ref: ${config.ref}, Repo: ${config.repo}`);

  const result = await deploy(config, sourceRepoDir);

  core.setOutput('version', result.version);
  core.setOutput('url', result.url);
  core.info(`Deployed ${result.version} to ${result.url}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
