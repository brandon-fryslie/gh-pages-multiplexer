// [LAW:single-enforcer] This module is the only place that knows the SEO marker,
//   the canonical/noindex tag formats, and the HTML injection rules.
// [LAW:one-source-of-truth] CANONICAL_MARKER / NOINDEX_MARKER are the sole identity
//   checks for "this file already has our SEO tag." Same pattern as WIDGET_MARKER.
// [LAW:dataflow-not-control-flow] Walk → read → decide → write. Empty lists produce
//   zero side effects. Variability is data (tag content), not skipped operations.
// [LAW:no-defensive-null-guards] fs errors propagate; we do not swallow failures.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import { findHtmlFilesRelative, findSlotHtmlFiles, slotPageUrl } from './slot-pages.js';

export const CANONICAL_MARKER = '<!-- gh-pages-multiplexer:canonical -->';
export const NOINDEX_MARKER = '<!-- gh-pages-multiplexer:noindex -->';

// Matches any existing gh-pm canonical block (marker + link tag). We only replace
// tags we injected ourselves; user-authored canonicals are respected and skipped.
const EXISTING_CANONICAL_BLOCK_RE = new RegExp(
  `${CANONICAL_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*<link rel="canonical"[^>]*>`,
  'g',
);

// Detect user-authored canonical (any `<link rel="canonical"` not preceded by our marker).
const USER_CANONICAL_RE = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;

function buildCanonicalTag(url: string): string {
  // Minimal HTML escape for attribute value (URLs rarely contain these, but be safe).
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `${CANONICAL_MARKER}<link rel="canonical" href="${safe}">`;
}

function buildNoindexTag(): string {
  return `${NOINDEX_MARKER}<meta name="robots" content="noindex,nofollow">`;
}

function insertInHead(html: string, tag: string): string {
  // Prefer inserting right after <head> opening tag; fall back to before </head>.
  // [LAW:dataflow-not-control-flow] Three data-driven positions, single insertion op.
  const headOpen = html.search(/<head[^>]*>/i);
  if (headOpen !== -1) {
    const end = html.indexOf('>', headOpen) + 1;
    return html.slice(0, end) + tag + html.slice(end);
  }
  const headClose = html.toLowerCase().lastIndexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  // Malformed HTML: no <head>. Prepend with a minimal head. Same pattern as widget-injector.
  return `<head>${tag}</head>` + html;
}

/** The slot canonicals point at, and the slot-relative paths of the pages it has. */
export interface CanonicalSlot {
  slot: string;
  pages: ReadonlySet<string>;
}

export interface CanonicalCounts {
  /** Files whose canonical tag was added or changed. */
  written: number;
  /** Pages with no counterpart in the canonical slot, canonicalized to themselves. */
  selfCanonical: number;
}

/**
 * Inject or update the canonical tag on every HTML file of `slot` (under `workdir`). A page points at
 * the same page in `canonical` when that slot has it, and at itself otherwise: a canonical naming a
 * page that does not exist tells crawlers to drop the only live copy. Idempotent: existing gh-pm
 * canonicals are replaced; user-authored canonicals are respected (skipped).
 */
export async function injectCanonicalIntoDir(
  workdir: string,
  slot: string,
  siteBase: string,
  canonical: CanonicalSlot,
): Promise<CanonicalCounts> {
  const versionDir = path.join(workdir, slot);
  const relPaths = await findHtmlFilesRelative(versionDir);
  const counts: CanonicalCounts = { written: 0, selfCanonical: 0 };
  for (const rel of relPaths) {
    const file = path.join(versionDir, rel);
    // [LAW:dataflow-not-control-flow] Every page gets a canonical; only its target slot varies.
    const targetSlot = canonical.pages.has(rel) ? canonical.slot : slot;
    if (targetSlot !== canonical.slot) counts.selfCanonical++;
    const tag = buildCanonicalTag(slotPageUrl(siteBase, targetSlot, rel));

    const original = await readFile(file, 'utf8');
    // Remove any of our previously-injected canonicals (handles update-on-latest-change).
    const stripped = original.replace(EXISTING_CANONICAL_BLOCK_RE, '');
    // If the user authored their own canonical, respect it — don't inject ours.
    const hasUserCanonical = USER_CANONICAL_RE.test(stripped);
    const next = hasUserCanonical ? stripped : insertInHead(stripped, tag);

    if (next !== original) {
      await writeFile(file, next, 'utf8');
      counts.written++;
    }
  }
  return counts;
}

/**
 * Inject a noindex meta tag into every HTML file in `prDir`. Idempotent
 * (marker-gated). Used for PR preview directories so they don't get indexed
 * even when a crawler bypasses robots.txt or the host doesn't support it.
 *
 * Returns the count of files newly injected.
 */
export async function injectNoindexIntoDir(prDir: string): Promise<number> {
  const htmlFiles = await findSlotHtmlFiles(prDir);
  if (htmlFiles.length === 0) {
    core.info(`0 HTML files in ${prDir}, no noindex injection needed`);
    return 0;
  }

  const tag = buildNoindexTag();
  let count = 0;
  for (const file of htmlFiles) {
    const original = await readFile(file, 'utf8');
    if (original.includes(NOINDEX_MARKER)) continue;
    const next = insertInHead(original, tag);
    await writeFile(file, next, 'utf8');
    count++;
  }
  return count;
}
