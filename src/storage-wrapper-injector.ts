// [LAW:single-enforcer] This module is the only place that places the storage
//   wrapper script tag into HTML files.
// [LAW:one-source-of-truth] A deployed page is the record of whether its slot's deploy opted into
//   the wrapper: a page carrying a wrapper block has it re-rendered from the current template on
//   every deploy, and only the slot a deploy opts in gains blocks where its pages have none.
// [LAW:no-defensive-null-guards] fs errors propagate; we do not swallow failures.
import { readFile, writeFile } from 'node:fs/promises';
import {
  STORAGE_WRAPPER_MARKER,
  readStorageWrapperNamespace,
  renderStorageWrapperScriptTag,
  type StorageWrapperOpts,
} from './storage-wrapper.js';
import type { PlacementCounts, WrapperCoverage } from './types.js';
import { emptyPlacementCounts, findSlotHtmlFiles, refreshBlock, type PlacedPage } from './slot-pages.js';

// The head's first child goes right after the page's prologue: the doctype, <html> and <head> start
// tags, and the whitespace and comments between them. Only those can come before the head, so a
// `<head` anywhere later is text, not the tag. A page may omit any of them (the parser then opens
// the head itself), so every part is optional and this matches every document, if only as "".
const HEAD_START = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?(?:\s|<!--[\s\S]*?-->)*(?:<html(?=[\s>])[^>]*>)?(?:\s|<!--[\s\S]*?-->)*(?:<head(?=[\s>])[^>]*>)?/i;

/** Insert tag as the head's first child, so it runs before any script the page carries. */
function insertAtHeadStart(html: string, tag: string): string {
  const end = HEAD_START.exec(html)![0].length;
  return html.slice(0, end) + tag + html.slice(end);
}

const STORAGE_WRAPPER_OPEN = `${STORAGE_WRAPPER_MARKER}<script>`;

// [LAW:dataflow-not-control-flow] Coverage is data: it picks what a page without a wrapper block becomes.
const PAGE_WITHOUT_WRAPPER: Record<WrapperCoverage, (html: string, tag: string) => PlacedPage | null> = {
  'every-page': (html, tag) => ({ html: insertAtHeadStart(html, tag), placement: 'inserted' }),
  'wrapped-pages': () => null,
};

// A page's wrapper is re-rendered from the current template with the namespace the page already
// carries: its users' data lives under that prefix, whatever owner/repo spelling this deploy has.
function rerenderWrapper(filePath: string): (block: string) => string {
  return (block) => renderStorageWrapperScriptTag({ namespace: readStorageWrapperNamespace(block, filePath) });
}

/**
 * Walk `slotDir` recursively and place the current storage wrapper in the *.html files `coverage`
 * selects: inserted with `opts` where a page has none, re-rendered where an earlier deploy left one.
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
    const placed = refreshBlock(original, STORAGE_WRAPPER_OPEN, rerenderWrapper(file), file) ??
      PAGE_WITHOUT_WRAPPER[coverage](original, tag);
    if (placed === null) continue;
    if (placed.placement !== 'current') await writeFile(file, placed.html, 'utf8');
    counts[placed.placement]++;
  }
  return counts;
}
