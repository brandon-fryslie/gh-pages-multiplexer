// [LAW:one-source-of-truth] The sitemap lists exactly the canonical tags' targets: the newest
//   non-PR copy of every page path. PR previews are explicitly excluded (they're noindex-tagged; listing them in a
//   sitemap would contradict that).
// [LAW:dataflow-not-control-flow] renderSitemapXml always runs: urls array maps
//   to <url> elements, empty array yields a valid empty <urlset>. No guarded skips.
import type { Manifest, PageCopies } from './types.js';
import { escapeHtml } from './index-renderer.js';
import { slotPageUrl } from './slot-pages.js';

const PR_VERSION_RE = /^pr-\d+$/;

/** The non-PR version slots of `manifest`, newest first (the manifest's order). */
export function nonPrSlots(manifest: Manifest): string[] {
  return manifest.versions.filter((v) => !PR_VERSION_RE.test(v.version)).map((v) => v.version);
}

/**
 * Find the most recently deployed non-PR version slot. Returns null when no
 * such version exists (empty manifest or all-PR manifest).
 */
export function latestNonPrSlot(manifest: Manifest): string | null {
  return nonPrSlots(manifest)[0] ?? null;
}

/**
 * Render a sitemap.xml listing the canonical copy of every page in `copies`. The `loc` URLs are
 * absolute and percent-encoded.
 *
 * baseUrl: site base (e.g., "https://example.com" or "https://owner.github.io/repo")
 * copies: page paths with the versions that have them, canonical copy first
 * lastmod: ISO 8601 date string (typically the deploy timestamp)
 */
export function renderSitemapXml(
  baseUrl: string,
  copies: readonly PageCopies[],
  lastmod: string,
): string {
  const dateOnly = lastmod.slice(0, 10);  // YYYY-MM-DD per sitemap spec
  const header =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  const body = copies
    .map(({ page, versions }) => {
      const loc = slotPageUrl(baseUrl, versions[0], page);
      return `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${escapeHtml(dateOnly)}</lastmod>\n  </url>\n`;
    })
    .join('');
  return header + body + '</urlset>\n';
}
