import * as core from '@actions/core';
import type { DeployConfig } from './types.js';

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
  const config = parseInputs();
  core.info(`Deploying from ${config.sourceDir} to ${config.targetBranch}`);
  core.info(`Ref: ${config.ref}, Repo: ${config.repo}`);

  // Pipeline stages wired in Plan 03:
  // 1. resolveRef(config) -> DeploymentContext
  // 2. prepareBranch(config) -> workdir
  // 3. updateManifest(workdir, context) -> Manifest
  // 4. placeContent(workdir, config, context) -> void
  // 5. commitAndPush(workdir, context) -> void

  core.setOutput('version', 'stub');
  core.setOutput('url', 'stub');
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
