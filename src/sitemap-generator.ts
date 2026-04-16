// [LAW:one-source-of-truth] The sitemap reflects the latest non-PR version only.
//   PR previews are explicitly excluded (they're noindex-tagged; listing them in a
//   sitemap would contradict that).
// [LAW:dataflow-not-control-flow] renderSitemapXml always runs: urls array maps
//   to <url> elements, empty array yields a valid empty <urlset>. No guarded skips.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from './types.js';
import { escapeHtml } from './index-renderer.js';

const PR_VERSION_RE = /^pr-\d+$/;

/**
 * Find the most recently deployed non-PR version slot. Returns null when no
 * such version exists (empty manifest or all-PR manifest).
 */
export function latestNonPrSlot(manifest: Manifest): string | null {
  const entry = manifest.versions.find((v) => !PR_VERSION_RE.test(v.version));
  return entry ? entry.version : null;
}

/**
 * Walk `dir` and return absolute paths to every *.html file below it.
 * Empty directory or missing directory yields [].
 */
export async function findHtmlFilesRelative(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) out.push(rel);
    }
  }
  await walk(root, '');
  return out.sort();
}

/**
 * Render a sitemap.xml for the given set of relative URLs, rooted under a
 * version slot within a site. The `loc` URLs are absolute.
 *
 * baseUrl: site base (e.g., "https://example.com" or "https://owner.github.io/repo")
 * slot: version directory name (e.g., "v2.0.0")
 * htmlRelPaths: relative HTML paths under the slot (e.g., ["index.html", "docs/api.html"])
 * lastmod: ISO 8601 date string (typically the deploy timestamp)
 */
export function renderSitemapXml(
  baseUrl: string,
  slot: string,
  htmlRelPaths: string[],
  lastmod: string,
): string {
  const dateOnly = lastmod.slice(0, 10);  // YYYY-MM-DD per sitemap spec
  const header =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  const body = htmlRelPaths
    .map((rel) => {
      const loc = `${baseUrl}/${slot}/${rel}`;
      return `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${escapeHtml(dateOnly)}</lastmod>\n  </url>\n`;
    })
    .join('');
  return header + body + '</urlset>\n';
}

/**
 * Empty sitemap (valid but with no URLs). Emitted when no non-PR version
 * exists — still a valid sitemap, just zero entries.
 */
export function renderEmptySitemap(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '</urlset>\n'
  );
}
