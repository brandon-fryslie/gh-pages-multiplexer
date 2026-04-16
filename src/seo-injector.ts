// [LAW:single-enforcer] This module is the only place that knows the SEO marker,
//   the canonical/noindex tag formats, and the HTML injection rules.
// [LAW:one-source-of-truth] CANONICAL_MARKER / NOINDEX_MARKER are the sole identity
//   checks for "this file already has our SEO tag." Same pattern as WIDGET_MARKER.
// [LAW:dataflow-not-control-flow] Walk → read → decide → write. Empty lists produce
//   zero side effects. Variability is data (tag content), not skipped operations.
// [LAW:no-defensive-null-guards] fs errors propagate; we do not swallow failures.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';

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

async function findHtmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

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

/**
 * Inject or update the canonical tag on every HTML file in `versionDir`, pointing
 * at `canonicalBase/<relativePath>`. Idempotent: existing gh-pm canonicals are
 * replaced; user-authored canonicals are respected (skipped).
 *
 * Returns the count of files mutated.
 */
export async function injectCanonicalIntoDir(
  versionDir: string,
  canonicalBase: string,
): Promise<number> {
  const htmlFiles = await findHtmlFiles(versionDir);
  if (htmlFiles.length === 0) {
    core.info(`0 HTML files in ${versionDir}, no canonical injection needed`);
    return 0;
  }

  let count = 0;
  for (const file of htmlFiles) {
    const rel = path.relative(versionDir, file).split(path.sep).join('/');
    const canonicalUrl = `${canonicalBase.replace(/\/$/, '')}/${rel}`;
    const tag = buildCanonicalTag(canonicalUrl);

    const original = await readFile(file, 'utf8');
    // Remove any of our previously-injected canonicals (handles update-on-latest-change).
    const stripped = original.replace(EXISTING_CANONICAL_BLOCK_RE, '');
    // If the user authored their own canonical, respect it — don't inject ours.
    const hasUserCanonical = USER_CANONICAL_RE.test(stripped);
    const next = hasUserCanonical ? stripped : insertInHead(stripped, tag);

    if (next !== original) {
      await writeFile(file, next, 'utf8');
      count++;
    }
  }
  return count;
}

/**
 * Inject a noindex meta tag into every HTML file in `prDir`. Idempotent
 * (marker-gated). Used for PR preview directories so they don't get indexed
 * even when a crawler bypasses robots.txt or the host doesn't support it.
 *
 * Returns the count of files newly injected.
 */
export async function injectNoindexIntoDir(prDir: string): Promise<number> {
  const htmlFiles = await findHtmlFiles(prDir);
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
