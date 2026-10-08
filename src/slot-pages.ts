// [LAW:single-enforcer] The one place that re-renders a script block this action owns inside a page.
//   The nav widget and the storage wrapper both find a slot's pages and place their blocks through it.
// [LAW:no-defensive-null-guards] fs errors propagate; only a slot with no directory reads as zero pages.
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { PLACEMENTS, type Placement, type PlacementCounts } from './types.js';

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
