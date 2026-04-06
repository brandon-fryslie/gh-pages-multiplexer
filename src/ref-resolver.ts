// [LAW:single-enforcer] Ref sanitization is the single enforcement point for filesystem-safe version slot names (T-01-01).
// [LAW:dataflow-not-control-flow] resolveContext always runs the same steps; basePath variability lives in the data (config + cname flag).
import picomatch from 'picomatch';
import type { DeployConfig, DeploymentContext } from './types.js';

/**
 * Sanitize a git ref into a single-segment, filesystem-safe directory name.
 * Implements D-04/D-06 and mitigates T-01-01 (path traversal via ref name).
 */
export function sanitizeRef(ref: string): string {
  // Strip well-known ref prefixes. PR refs map to pr-N.
  const stripped = ref
    .replace(/^refs\/tags\//, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/pull\/(\d+)\/merge$/, 'pr-$1');

  // Remove control characters and null bytes entirely.
  // eslint-disable-next-line no-control-regex
  const noControl = stripped.replace(/[\x00-\x1f\x7f]/g, '');

  // Split into segments, drop any `..` segments (path traversal defense), then rejoin with hyphens.
  const segments = noControl.split('/').filter((seg) => seg !== '..' && seg.length > 0);
  const joined = segments.join('-');

  // Replace remaining filesystem-unsafe characters with hyphens.
  const safe = joined
    .replace(/[\\:*?"<>|/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (safe.length === 0) {
    throw new Error(`Ref "${ref}" sanitized to an empty string`);
  }
  return safe;
}

/**
 * Test a versionSlot against a list of glob patterns. Empty list matches everything.
 */
export function matchesPatterns(versionSlot: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((p) => picomatch.isMatch(versionSlot, p));
}

/**
 * Derive a DeploymentContext from config. Throws if the ref fails pattern filtering.
 * `cname` indicates a custom domain is configured on the gh-pages branch (Pitfall 6).
 */
export function resolveContext(config: DeployConfig, cname = false): DeploymentContext {
  const versionSlot = sanitizeRef(config.ref);

  if (!matchesPatterns(versionSlot, config.refPatterns)) {
    throw new Error(
      `Ref ${config.ref} (slot ${versionSlot}) does not match any deployment pattern: ${config.refPatterns.join(', ')}`
    );
  }

  const repoName = config.repo.includes('/') ? config.repo.split('/')[1] : config.repo;
  const isUserSite = /\.github\.io$/i.test(repoName);

  let basePath: string;
  if (config.basePathPrefix && config.basePathPrefix.length > 0) {
    basePath = `/${config.basePathPrefix}/${versionSlot}/`;
  } else if (isUserSite || cname) {
    basePath = `/${versionSlot}/`;
  } else {
    basePath = `/${repoName}/${versionSlot}/`;
  }
  // Normalize leading/trailing slashes and collapse duplicates.
  basePath = ('/' + basePath.replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');

  return {
    versionSlot,
    originalRef: config.ref,
    sha: process.env.GITHUB_SHA ?? '',
    timestamp: new Date().toISOString(),
    basePath,
  };
}
