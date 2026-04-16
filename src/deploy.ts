// [LAW:dataflow-not-control-flow] The deploy pipeline runs the same 5 stages in the same order
//   every invocation. Variability (first-time branch vs existing, redeploy vs new version,
//   custom domain vs project site) lives in the data flowing through the stages -- never in
//   whether a stage executes.
// [LAW:single-enforcer] deploy.ts is the single wiring point for the pipeline. Stage modules
//   do not know about each other.
// [LAW:one-type-per-behavior] One deploy implementation. The Action adapter (src/index.ts) and
//   the CLI adapter (src/cli.ts, Plan 05-02) both call this same function. They differ ONLY
//   in how they gather DeployConfig.
// [LAW:variability-at-edges] Pipeline core stays fixed; adapters handle CI-specific quirks.
import * as core from '@actions/core';
import type { DeployConfig, DeployResult, ManifestEntry } from './types.js';
import { resolveContext } from './ref-resolver.js';
import {
  prepareBranch,
  commitAndPush,
  cleanupWorktree,
  readCnameFile,
  writeIndexHtml,
  injectWidgetForVersion,
  removeVersionDirectories,
  writeRobotsTxt,
  writeSitemapXml,
  writeHealthJson,
  writeStatsHtml,
  applySeoTags,
} from './branch-manager.js';
import { readManifest, updateManifest, removeVersions, writeManifest } from './manifest-manager.js';
import { placeContent } from './content-placer.js';
import { extractCommits } from './metadata-extractor.js';
import { latestNonPrSlot } from './sitemap-generator.js';

const PR_VERSION_RE = /^pr-\d+$/;

export async function deploy(config: DeployConfig, sourceRepoDir: string): Promise<DeployResult> {
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
    const commits = await extractCommits(sourceRepoDir, context.sha, previousSha, config.prBaseRef);
    core.info(`Captured ${commits.length} commit(s) for ${context.versionSlot}`);

    const entry: ManifestEntry = {
      version: context.versionSlot,
      ref: context.originalRef,
      sha: context.sha,
      timestamp: context.timestamp,
      commits,
      release: config.release,  // undefined when not a tag or no release exists → key omitted from JSON
    };
    // [LAW:dataflow-not-control-flow] Two pure transforms chained on manifest data:
    //   read → add new entry → remove stale entries → write. Both always run;
    //   empty cleanupVersions = identity transform in removeVersions.
    const withNewEntry = updateManifest(currentManifest, entry);
    const cleanedManifest = removeVersions(withNewEntry, config.cleanupVersions);
    await writeManifest(workdir, cleanedManifest);

    // Remove stale version directories from the worktree.
    // [LAW:single-enforcer] Worktree I/O goes through branch-manager.
    const removedCount = await removeVersionDirectories(workdir, config.cleanupVersions);
    core.info(`Cleanup: removed ${removedCount} stale version(s)`);

    // [LAW:dataflow-not-control-flow] INDX-06: index.html is regenerated on every
    // deploy from the manifest. Runs unconditionally. Lands in the same commit as
    // versions.json via the shared commitAndPush step (MNFST-04 / INDX-06).
    const [repoOwner, repoName] = config.repo.split('/');
    await writeIndexHtml(workdir, cleanedManifest, { owner: repoOwner, repo: repoName });

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
      {
        icon: config.widgetIcon,
        label: config.widgetLabel,
        position: config.widgetPosition,
        color: config.widgetColor,
      },
    );
    core.info(`Injected nav widget into ${injectedCount} HTML file(s) in ${context.versionSlot}`);

    // Stage 4.7: SEO tags. Canonical URLs on all non-PR versions (pointing at the
    // latest non-PR); noindex on the current PR directory (if this deploy is a PR).
    // [LAW:dataflow-not-control-flow] Always runs. Empty slot list = zero canonicals.
    //   null PR slot = zero noindex injections. No guarded skips.
    const owner = config.repo.includes('/') ? config.repo.split('/')[0] : config.repo;
    const baseUrl = cnameDomain !== null ? `https://${cnameDomain}` : `https://${owner}.github.io`;
    const siteRoot = context.basePath.slice(0, context.basePath.length - (context.versionSlot.length + 1));
    const siteBase = `${baseUrl}${siteRoot}`.replace(/\/$/, '');
    const latestSlot = latestNonPrSlot(cleanedManifest);
    const latestNonPrSiteBase = latestSlot ? `${siteBase}/${latestSlot}` : null;
    const nonPrSlots = cleanedManifest.versions
      .filter((v) => !PR_VERSION_RE.test(v.version))
      .map((v) => v.version);
    const currentPrSlot = PR_VERSION_RE.test(context.versionSlot) ? context.versionSlot : null;
    const seoCounts = await applySeoTags(workdir, nonPrSlots, latestNonPrSiteBase, currentPrSlot);
    core.info(`SEO: injected ${seoCounts.canonicalCount} canonical, ${seoCounts.noindexCount} noindex tag(s)`);

    // Stage 4.8: Crawler & monitoring artifacts — robots.txt, sitemap.xml, _health.json.
    // Written at the worktree root. Stats dashboard lives under _versions/.
    // [LAW:dataflow-not-control-flow] All four writes run every deploy; content varies with manifest.
    await writeRobotsTxt(workdir, cleanedManifest, siteRoot);
    await writeSitemapXml(workdir, cleanedManifest, siteBase, context.timestamp);
    await writeHealthJson(workdir, cleanedManifest, context.timestamp);
    await writeStatsHtml(workdir, { owner: repoOwner, repo: repoName });

    // Stage 5: Commit and push. Manifest + content land in one commit (MNFST-04).
    await commitAndPush(workdir, context, config.targetBranch);

    const url = `${baseUrl}${context.basePath}`;

    return { version: context.versionSlot, url, removedVersions: config.cleanupVersions };
  } finally {
    // Cleanup runs whether deploy succeeded or threw. Failure to clean up is
    // logged as a warning but never masks the original error.
    await cleanupWorktree(workdir).catch((e: unknown) => {
      core.warning(`Worktree cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}
