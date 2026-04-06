// [LAW:dataflow-not-control-flow] The deploy pipeline runs the same 5 stages in the same order
//   every invocation. Variability (first-time branch vs existing, redeploy vs new version,
//   custom domain vs project site) lives in the data flowing through the stages -- never in
//   whether a stage executes.
// [LAW:single-enforcer] index.ts is the single wiring point for the pipeline. Stage modules
//   do not know about each other.
import * as core from '@actions/core';
import type { DeployConfig, DeployResult, ManifestEntry } from './types.js';
import { resolveContext } from './ref-resolver.js';
import { prepareBranch, commitAndPush, cleanupWorktree, readCnameFile, writeIndexHtml, injectWidgetForVersion } from './branch-manager.js';
import { readManifest, updateManifest, writeManifest } from './manifest-manager.js';
import { placeContent } from './content-placer.js';
import { extractCommits } from './metadata-extractor.js';

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

async function deploy(config: DeployConfig, sourceRepoDir: string): Promise<DeployResult> {
  // Mask the token in logs even if a downstream tool prints it. (T-01-08 mitigation)
  if (config.token) core.setSecret(config.token);

  // Stage 1: Prepare branch (git worktree)
  const workdir = await prepareBranch(config);

  try {
    // Stage 2: Resolve ref context. CNAME presence affects basePath computation.
    const cnameDomain = await readCnameFile(workdir);
    const context = resolveContext(config, cnameDomain !== null);
    core.info(`Version: ${context.versionSlot}, Base path: ${context.basePath}`);

    // Stage 3: Read manifest, extract commits, update (pure), write.
    const currentManifest = await readManifest(workdir);
    const previousSha =
      currentManifest.versions.find((v) => v.version === context.versionSlot)?.sha ?? null;
    // [LAW:dataflow-not-control-flow] extractCommits runs every deploy; range selection lives in data (previousSha nullable).
    const commits = await extractCommits(sourceRepoDir, context.sha, previousSha);
    core.info(`Captured ${commits.length} commit(s) for ${context.versionSlot}`);

    const entry: ManifestEntry = {
      version: context.versionSlot,
      ref: context.originalRef,
      sha: context.sha,
      timestamp: context.timestamp,
      commits,
    };
    const updatedManifest = updateManifest(currentManifest, entry);
    await writeManifest(workdir, updatedManifest);

    // [LAW:dataflow-not-control-flow] INDX-06: index.html is regenerated on every
    // deploy from the manifest. Runs unconditionally. Lands in the same commit as
    // versions.json via the shared commitAndPush step (MNFST-04 / INDX-06).
    const [repoOwner, repoName] = config.repo.split('/');
    await writeIndexHtml(workdir, updatedManifest, { owner: repoOwner, repo: repoName });

    // Stage 4: Place content (copy + base path correction + .nojekyll).
    await placeContent(workdir, config.sourceDir, context, config.basePathMode);

    // Stage 4.5: Inject the navigation widget into every deployed HTML page.
    // [LAW:dataflow-not-control-flow] Always runs after placeContent in the same order every deploy.
    // [LAW:single-enforcer] Goes through branch-manager.injectWidgetForVersion -- the only writer to
    // the gh-pages worktree.
    // NAVW-01..05: widget injection lands in the same atomic commit as the manifest and root index.
    const injectedCount = await injectWidgetForVersion(
      workdir,
      context.versionSlot,
      { owner: repoOwner, repo: repoName },
    );
    core.info(`Injected nav widget into ${injectedCount} HTML file(s) in ${context.versionSlot}`);

    // Stage 5: Commit and push. Manifest + content land in one commit (MNFST-04).
    await commitAndPush(workdir, context, config.targetBranch);

    // Compute deployed URL. Custom domain uses actual CNAME contents (not a placeholder).
    const owner = config.repo.includes('/') ? config.repo.split('/')[0] : config.repo;
    const baseUrl = cnameDomain !== null ? `https://${cnameDomain}` : `https://${owner}.github.io`;
    const url = `${baseUrl}${context.basePath}`;

    return { version: context.versionSlot, url };
  } finally {
    // Cleanup runs whether deploy succeeded or threw. Failure to clean up is
    // logged as a warning but never masks the original error.
    await cleanupWorktree(workdir).catch((e: unknown) => {
      core.warning(`Worktree cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
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
