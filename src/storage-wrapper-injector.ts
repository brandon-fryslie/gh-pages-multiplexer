// [LAW:single-enforcer] This module is the only place that places the storage
//   wrapper script tag into HTML files.
// [LAW:one-source-of-truth] A deployed page is the record of whether its slot's deploy opted into
//   the wrapper: a page carrying a wrapper block has it re-rendered from the current template on
//   every deploy, and only the slot a deploy opts in gains blocks where its pages have none.
// [LAW:no-defensive-null-guards] fs errors propagate; we do not swallow failures.
import { readFile, writeFile } from 'node:fs/promises';
import {
  STORAGE_WRAPPER_MARKER,
  renderStorageWrapperScriptTag,
  type StorageWrapperOpts,
} from './storage-wrapper.js';
import type { PlacementCounts } from './types.js';
import { emptyPlacementCounts, findSlotHtmlFiles, refreshBlock, type PlacedPage } from './slot-pages.js';

/** Which pages of a slot carry the wrapper: all of them, or those whose deploy already put one there. */
export type WrapperCoverage = 'every-page' | 'wrapped-pages';

/**
 * Insert tag as the first child of <head>, or before </head> if no opening tag
 * is found, or wrap the document in a minimal <head> for pathological HTML.
 * [LAW:dataflow-not-control-flow] Three data-driven positions, one insertion op.
 */
function insertAtHeadStart(html: string, tag: string): string {
  const headOpen = html.search(/<head[^>]*>/i);
  if (headOpen !== -1) {
    const end = html.indexOf('>', headOpen) + 1;
    return html.slice(0, end) + tag + html.slice(end);
  }
  const headClose = html.toLowerCase().lastIndexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  return `<head>${tag}</head>` + html;
}

const STORAGE_WRAPPER_OPEN = `${STORAGE_WRAPPER_MARKER}<script>`;

// [LAW:dataflow-not-control-flow] Coverage is data: it picks what a page without a wrapper block becomes.
const PAGE_WITHOUT_WRAPPER: Record<WrapperCoverage, (html: string, tag: string) => PlacedPage | null> = {
  'every-page': (html, tag) => ({ html: insertAtHeadStart(html, tag), placement: 'inserted' }),
  'wrapped-pages': () => null,
};

/**
 * Walk `slotDir` recursively and place the current storage wrapper in the *.html files `coverage`
 * selects: inserted where a page has none, replacing the block where an earlier deploy left one.
 * Files whose block is already current are not rewritten.
 */
export async function placeStorageWrapperInSlot(
  slotDir: string,
  opts: StorageWrapperOpts,
  coverage: WrapperCoverage,
): Promise<PlacementCounts> {
  const tag = renderStorageWrapperScriptTag(opts);
  const counts = emptyPlacementCounts();
  for (const file of await findSlotHtmlFiles(slotDir)) {
    const original = await readFile(file, 'utf8');
    const placed = refreshBlock(original, STORAGE_WRAPPER_OPEN, tag, file) ?? PAGE_WITHOUT_WRAPPER[coverage](original, tag);
    if (placed === null) continue;
    if (placed.placement !== 'current') await writeFile(file, placed.html, 'utf8');
    counts[placed.placement]++;
  }
  return counts;
}
