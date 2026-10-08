// [LAW:one-source-of-truth] The sitemap reflects the latest non-PR version only.
//   PR previews are explicitly excluded (they're noindex-tagged; listing them in a
//   sitemap would contradict that).
// [LAW:dataflow-not-control-flow] renderSitemapXml always runs: urls array maps
//   to <url> elements, empty array yields a valid empty <urlset>. No guarded skips.
import type { Manifest } from './types.js';
import { escapeHtml } from './index-renderer.js';
import { slotPageUrl } from './slot-pages.js';

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
 * Render a sitemap.xml for the given set of relative URLs, rooted under a
 * version slot within a site. The `loc` URLs are absolute and percent-encoded.
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
      const loc = slotPageUrl(baseUrl, slot, rel);
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
