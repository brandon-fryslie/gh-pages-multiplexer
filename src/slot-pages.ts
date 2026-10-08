// [LAW:single-enforcer] The one walk that finds a slot's pages, and the one place that re-renders a
//   script block this action owns inside a page. Content placement, SEO tags, the sitemap, the nav
//   widget and the storage wrapper all find a slot's pages through it. It is also the one place that
//   turns a slot page into the absolute URL the sitemap and canonical tags publish.
// [LAW:no-defensive-null-guards] fs errors propagate; only a manifest slot with no directory reads as zero pages.
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { PLACEMENTS, type Placement, type PlacementCounts } from './types.js';

// Every *.html file below `dir`, which must exist.
export async function findHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// A slot listed in versions.json can have no directory: git does not track empty directories, so a
// slot deployed from a source dir with no files has none. Such a slot has zero pages, like an empty one.
export async function findSlotHtmlFiles(slotDir: string): Promise<string[]> {
  try {
    return await findHtmlFiles(slotDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' && (err as NodeJS.ErrnoException).path === slotDir) return [];
    throw err;
  }
}

/**
 * Every *.html page in the slot at `slotDir`, as sorted slot-relative URL paths
 * (e.g. "docs/api.html"). A slot with no directory has no pages.
 */
export async function findHtmlFilesRelative(slotDir: string): Promise<string[]> {
  const files = await findSlotHtmlFiles(slotDir);
  return files.map((file) => path.relative(slotDir, file).split(path.sep).join('/')).sort();
}

/**
 * The absolute URL of the page at `relPath` ("docs/my page.html") in `slot`, under `siteBase`
 * ("https://example.com/repo", no trailing slash). Slot and page names are filesystem names, so every
 * path segment is percent-encoded: a space or `#` in a name must not end up raw in the URL.
 */
export function slotPageUrl(siteBase: string, slot: string, relPath: string): string {
  const segments = [slot, ...relPath.split('/')];
  return `${siteBase}/${segments.map(encodeURIComponent).join('/')}`;
}

export interface PlacedPage {
  html: string;
  placement: Placement;
}

const SCRIPT_CLOSE = '</script>';

/**
 * Replaces the block in `html` that opens with `open` by `render(existing block)`. Every block this
 * action has ever emitted ends at the first </script> after its opening: each renderer escapes `</`
 * in the values it inlines. Null when the page carries no such block.
 */
export function refreshBlock(
  html: string,
  open: string,
  render: (existing: string) => string,
  filePath: string,
): PlacedPage | null {
  const start = html.indexOf(open);
  if (start === -1) return null;
  const close = html.indexOf(SCRIPT_CLOSE, start);
  if (close === -1) throw new Error(`${filePath}: block opening ${JSON.stringify(open)} has no closing ${SCRIPT_CLOSE}`);
  const end = close + SCRIPT_CLOSE.length;
  const placed = html.slice(0, start) + render(html.slice(start, end)) + html.slice(end);
  return { html: placed, placement: placed === html ? 'current' : 'refreshed' };
}

export function emptyPlacementCounts(): PlacementCounts {
  return { inserted: 0, refreshed: 0, current: 0 };
}

export function addPlacementCounts(total: PlacementCounts, counts: PlacementCounts): void {
  for (const placement of PLACEMENTS) total[placement] += counts[placement];
}
