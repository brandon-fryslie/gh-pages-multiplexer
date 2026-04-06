// [LAW:dataflow-not-control-flow] Always runs the same sequence: remove slot, copy, walk for .html, apply correction, ensure .nojekyll.
//   Variability lives in sourceDir contents and basePathMode enum, never in whether operations execute.
// [LAW:one-source-of-truth] The version subdirectory is derived from context.versionSlot -- no other location.
import { cp, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DeploymentContext } from './types.js';
import { injectBaseHref, rewriteUrls } from './base-path.js';

/**
 * Copy sourceDir into workdir/<versionSlot>/, then apply base path correction
 * to every .html file, then ensure .nojekyll exists at the workdir root.
 *
 * This is purely additive to the workdir: only the target version subdir and
 * .nojekyll are touched. Sibling version directories and root files
 * (CNAME, versions.json, etc.) are preserved (DEPL-01, Pitfall 4, Pitfall 5).
 */
export async function placeContent(
  workdir: string,
  sourceDir: string,
  context: DeploymentContext,
  basePathMode: 'base-tag' | 'rewrite'
): Promise<void> {
  const target = path.join(workdir, context.versionSlot);

  // Idempotent redeploy: clear the slot before copying.
  await rm(target, { recursive: true, force: true });

  // Copy source tree into the version slot.
  await cp(sourceDir, target, { recursive: true });

  // Walk the copied tree and apply base path correction to all .html files.
  const htmlFiles = await findHtmlFiles(target);
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const corrected =
      basePathMode === 'base-tag'
        ? injectBaseHref(html, context.basePath, path.basename(file))
        : rewriteUrls(html, context.basePath);
    await writeFile(file, corrected, 'utf8');
  }

  // Pitfall 4: ensure .nojekyll exists at the workdir root (create if missing).
  await writeFile(path.join(workdir, '.nojekyll'), '', { flag: 'a' });
}

async function findHtmlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findHtmlFiles(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}
