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
import type { DeployConfig, DeployResult, DeploymentContext, ManifestEntry, SourceRepo, PlacementCounts, RenamedSlot, SitemapCoverage, WrapperCoverage } from './types.js';
import { resolveContext } from './ref-resolver.js';
import {
  withWorktree,
  commitAndPush,
  readCnameFile,
  writeIndexHtml,
  injectWidgetIntoSlots,
  removeVersionDirectories,
  renameVersionDirectories,
  writeRobotsTxt,
  writeSitemapXml,
  writeHealthJson,
  writeStatsHtml,
  applySeoTags,
  placeStorageWrapperInSlots,
  readSlotPages,
} from './branch-manager.js';
import { readManifest, renameUnsafeSlots, updateManifest, removeVersions, writeManifest } from './manifest-manager.js';
import { placeContent } from './content-placer.js';
import { extractCommits } from './metadata-extractor.js';
import { latestNonPrSlot, nonPrSlots } from './sitemap-generator.js';
import { groupPageCopies, sitemapCoverage } from './seo-injector.js';

const PR_VERSION_RE = /^pr-\d+$/;

// [LAW:no-ambient-temporal-coupling] Optimistic concurrency: the remote tip is the one owner of
//   ordering. Every attempt renders the whole deployment (manifest + every derived file) on a fresh
//   worktree at the current tip and publishes with a non-force push, which the remote accepts only if
//   the tip has not moved. A moved tip means rebuild from the new tip -- never rebase, because a
//   rebased commit carries an index/sitemap/health rendered from a manifest that no longer exists.
// A stale rejection is a lost race only if the next probe finds a new tip: then another deploy
//   published, so a burst of N simultaneous deploys drains within N attempts each and no attempt
//   count or deadline is needed; the job runner's timeout owns how long a deploy may run. A rejection
//   whose tip never moved means the push and the probe disagree about the remote, and retrying
//   cannot fix that.
export async function deploy(config: DeployConfig, source: SourceRepo): Promise<DeployResult> {
  let lostOn: { tip: string; rejection: string } | null = null;
  for (let attempt = 1; ; attempt++) {
    // Stage 1: a git worktree at the current remote tip, removed when the attempt ends.
    const { tip, rendered, published } = await withWorktree(source, config.targetBranch, async (worktree) => {
      const tip = worktree.base.parents[0] ?? '(no branch)';
      if (lostOn?.tip === tip) {
        throw new Error(
          `Failed to publish to ${config.targetBranch}: attempt ${attempt - 1} was rejected as stale ` +
            `(${lostOn.rejection.trim()}) but the remote tip is still ${tip}, the commit it was built on. ` +
            `The push and the ls-remote probe disagree about the remote; check for a url.*.pushInsteadOf rewrite.`,
        );
      }
      const rendered = await renderDeployment(worktree.path, config, source.dir);
      // Stage 5: Commit and push. Manifest + content land in one commit (MNFST-04).
      const published = await commitAndPush(worktree, rendered.context, source.remote, config.targetBranch);
      return { tip, rendered, published };
    });
    core.info(`Publish attempt ${attempt} on ${tip}: ${published.kind}`);
    if (published.kind !== 'stale') {
      return {
        versionName: rendered.context.versionName,
        version: rendered.context.versionSlot,
        url: rendered.url,
        removedVersions: rendered.removedVersions,
        renamedVersions: rendered.renamedVersions,
        outcome: published.kind,
        attempts: attempt,
        widget: rendered.widget,
        storageWrapper: rendered.storageWrapper,
        sitemap: rendered.sitemap,
      };
    }
    lostOn = { tip, rejection: published.rejection };
    core.warning(`${config.targetBranch} moved during attempt ${attempt}; rebuilding from the new tip`);
  }
}

// The one summary line of a deploy, printed by both the CLI and the Action.
export function deploySummary(result: DeployResult): string {
  const placed = ({ inserted, refreshed, current }: PlacementCounts): string =>
    `${inserted} inserted, ${refreshed} refreshed, ${current} current`;
  return `Deployed ${result.versionName} as ${result.version} to ${result.url} (${result.outcome}, ${result.attempts} publish attempt(s); ` +
    `nav widget ${placed(result.widget)}; ` +
    `storage wrapper ${placed(result.storageWrapper.pages)}, ${result.storageWrapper.deployedSlot} in ${result.version}; ` +
    `sitemap ${result.sitemap.urls} URL(s): ${result.sitemap.urls - result.sitemap.fromOlderVersions} from ` +
    `${result.sitemap.latest ?? 'no non-PR version'}, ${result.sitemap.fromOlderVersions} from older versions; ` +
    `renamed ${result.renamedVersions.length} slot(s)${result.renamedVersions.map((r) => ` ${r.from} -> ${r.to} (${r.pages} page(s) rebased)`).join(',')})`;
}

/**
 * Stages 2-4.8: render the complete deployment into `workdir` -- manifest, version content,
 * and every file derived from that manifest. Reads and writes nothing outside `workdir` except
 * the source repo's commit log.
 */
async function renderDeployment(
  workdir: string,
  config: DeployConfig,
  sourceRepoDir: string,
): Promise<{
  context: DeploymentContext;
  url: string;
  removedVersions: string[];
  renamedVersions: RenamedSlot[];
  widget: PlacementCounts;
  storageWrapper: DeployResult['storageWrapper'];
  sitemap: SitemapCoverage;
}> {
  // Stage 2: Resolve ref context. CNAME presence affects basePath computation.
  const cnameDomain = await readCnameFile(workdir);
  const context = resolveContext(config, cnameDomain !== null);
  core.info(`Version: ${context.versionSlot}, Base path: ${context.basePath}`);

  // The URL path the gh-pages root is served from: the slot's base path with the slot removed.
  const siteRoot = context.basePath.slice(0, context.basePath.length - (context.versionSlot.length + 1));

  // Stage 3: Read manifest, rename slots that predate the slot-name rule, extract commits, update (pure), write.
  // [LAW:single-enforcer] Every slot in the manifest is a slot name from here on, so no output path encodes one.
  const { manifest: currentManifest, renames } = renameUnsafeSlots(await readManifest(workdir));
  const renamedVersions = await renameVersionDirectories(workdir, siteRoot, renames);
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
  // [LAW:one-source-of-truth] The slot this deploy publishes is never stale: a closed PR's late run
  //   republishes its slot, and the next deploy removes it. Manifest, directories, and the reported
  //   removals all read this one set, so no slot directory exists without its manifest entry.
  const staleVersions = config.cleanupVersions.filter((v) => v !== context.versionSlot);
  core.info(`Cleanup: stale [${staleVersions.join(', ')}] of closed [${config.cleanupVersions.join(', ')}]`);
  // [LAW:dataflow-not-control-flow] Two pure transforms chained on manifest data:
  //   read → add new entry → remove stale entries → write. Both always run;
  //   empty staleVersions = identity transform in removeVersions.
  const withNewEntry = updateManifest(currentManifest, entry);
  const cleanedManifest = removeVersions(withNewEntry, staleVersions);
  await writeManifest(workdir, cleanedManifest);

  // Remove stale version directories from the worktree.
  // [LAW:single-enforcer] Worktree I/O goes through branch-manager.
  const removedCount = await removeVersionDirectories(workdir, staleVersions);
  core.info(`Cleanup: removed ${removedCount} stale version(s)`);

  // [LAW:dataflow-not-control-flow] INDX-06: index.html is regenerated on every
  // deploy from the manifest. Runs unconditionally. Lands in the same commit as
  // versions.json via the shared commitAndPush step (MNFST-04 / INDX-06).
  const [repoOwner, repoName] = config.repo.split('/');
  await writeIndexHtml(workdir, cleanedManifest, { owner: repoOwner, repo: repoName });

  // Stage 4: Place content (copy + base path correction + .nojekyll).
  await placeContent(workdir, config.sourceDir, context, config.basePathMode);

  // Stage 4.5: Place the current navigation widget in every HTML page of every slot in the manifest.
  // [LAW:dataflow-not-control-flow] Always runs after placeContent in the same order every deploy.
  // [LAW:single-enforcer] Goes through branch-manager.injectWidgetIntoSlots -- the only writer to
  // the gh-pages worktree.
  // NAVW-01..05: widget injection lands in the same atomic commit as the manifest and root index.
  const widget = await injectWidgetIntoSlots(
    workdir,
    siteRoot,
    cleanedManifest.versions.map((v) => v.version),
    {
      icon: config.widgetIcon,
      label: config.widgetLabel,
      position: config.widgetPosition,
      color: config.widgetColor,
    },
  );

  // Stage 4.6: Place the current storage wrapper, which namespaces localStorage and sessionStorage so
  // repos on the same *.github.io origin don't collide. namespace-storage decides the deployed slot
  // only: its pages were just placed from the build. Every other slot keeps the choice its own deploy
  // made, recorded in its pages, and only has its wrappers re-rendered.
  const deployedSlot: WrapperCoverage = config.namespaceStorage ? 'every-page' : 'wrapped-pages';
  const storageWrapperPages = await placeStorageWrapperInSlots(
    workdir,
    { owner: repoOwner, repo: repoName },
    cleanedManifest.versions.map((v) => ({
      slot: v.version,
      coverage: v.version === context.versionSlot ? deployedSlot : 'wrapped-pages',
    })),
  );
  const storageWrapper = { deployedSlot, pages: storageWrapperPages };

  // Stage 4.7: SEO tags. Canonical URLs on all non-PR versions, each pointing at the
  // newest non-PR copy of its page; noindex on the current PR directory (if this deploy is a PR).
  // [LAW:one-source-of-truth] The canonical tags and sitemap.xml both read pageCopies.
  // [LAW:dataflow-not-control-flow] Always runs. Empty slot list = zero canonicals.
  //   null PR slot = zero noindex injections. No guarded skips.
  const owner = config.repo.includes('/') ? config.repo.split('/')[0] : config.repo;
  const baseUrl = cnameDomain !== null ? `https://${cnameDomain}` : `https://${owner}.github.io`;
  const siteBase = `${baseUrl}${siteRoot}`.replace(/\/$/, '');
  const pageCopies = groupPageCopies(await readSlotPages(workdir, nonPrSlots(cleanedManifest)));
  const currentPrSlot = PR_VERSION_RE.test(context.versionSlot) ? context.versionSlot : null;
  const seoCounts = await applySeoTags(workdir, pageCopies, siteBase, currentPrSlot);
  core.info(`SEO: injected ${seoCounts.canonicalCount} canonical, ${seoCounts.noindexCount} noindex tag(s)`);

  // Stage 4.8: Crawler & monitoring artifacts — robots.txt, sitemap.xml, _health.json.
  // Written at the worktree root. Stats dashboard lives under _versions/.
  // [LAW:dataflow-not-control-flow] All four writes run every deploy; content varies with manifest.
  await writeRobotsTxt(workdir, cleanedManifest, siteRoot);
  await writeSitemapXml(workdir, pageCopies, siteBase, context.timestamp);
  const sitemap = sitemapCoverage(latestNonPrSlot(cleanedManifest), pageCopies);
  await writeHealthJson(workdir, cleanedManifest, context.timestamp);
  await writeStatsHtml(workdir, { owner: repoOwner, repo: repoName });

  return { context, url: `${baseUrl}${context.basePath}`, removedVersions: staleVersions, renamedVersions, widget, storageWrapper, sitemap };
}
