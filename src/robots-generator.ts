// [LAW:one-source-of-truth] robots.txt is derived from the manifest. Every PR
//   version slot produces exactly one Disallow line. No second list of PRs exists.
// [LAW:dataflow-not-control-flow] renderRobotsTxt always runs the same steps:
//   filter PR entries → map to disallow lines → join. Empty manifest yields a
//   valid robots.txt with no disallows (allow-all). Variability lives in data.
import type { Manifest } from './types.js';

const PR_VERSION_RE = /^pr-\d+$/;

/**
 * Render the root robots.txt. Disallows crawlers from every PR preview directory.
 *
 * `siteRoot` is the URL path the gh-pages root is served from on the final domain.
 * For custom-domain sites: "/". For project sites: "/<repo>/".
 * (robots.txt lines are interpreted relative to the domain, not the file's location,
 *  so we must emit absolute paths that reflect the actual serving URL.)
 *
 * NOTE: robots.txt is only honored when it lives at the domain root. This works
 * natively for custom-domain deployments. For `<owner>.github.io/<repo>/` sites,
 * the file at `<repo>/robots.txt` is NOT picked up by crawlers — the meta noindex
 * tag injected into PR pages is the primary defense for those.
 */
export function renderRobotsTxt(manifest: Manifest, siteRoot: string): string {
  const prSlots = manifest.versions
    .filter((v) => PR_VERSION_RE.test(v.version))
    .map((v) => v.version);
  // Normalize siteRoot to have a single leading slash and exactly one trailing slash.
  const normalized = ('/' + siteRoot.replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
  const lines = [
    'User-agent: *',
    ...prSlots.map((slot) => `Disallow: ${normalized}${slot}/`),
    '',
  ];
  return lines.join('\n');
}
