// [LAW:single-enforcer] Ref sanitization is the single enforcement point for slot names: a slot name is
//   a string sanitizeRef maps to itself, so it is filesystem-safe (T-01-01) and URL-safe by construction.
// [LAW:dataflow-not-control-flow] resolveContext always runs the same steps; basePath variability lives in the data (config + cname flag).
import picomatch from 'picomatch';
import type { DeployConfig, DeploymentContext } from './types.js';
import { ROOT_ENTRIES } from './root-entries.js';

// Everything a slot name may not contain. What remains (RFC 3986 unreserved characters plus `@` and `+`)
// is a URL path segment as written: it needs no percent-encoding, no escaping in HTML, XML or JS
// strings, and means nothing to String.prototype.replace, so every output path writes a slot raw.
const NON_SLOT_CHARS = /[^A-Za-z0-9._~@+-]/gu;

// Root entry names folded to lower case: on a case-insensitive filesystem `CNAME` and `cname` are one entry.
const ROOT_ENTRY_NAMES = new Set(Object.values(ROOT_ENTRIES).map((name) => name.toLowerCase()));

/**
 * `~XX` for each UTF-8 byte of `char`: percent-encoding with `~` as the escape character, so the
 * escape is itself made of slot characters and a ref loses nothing (`v1#rc` -> `v1~23rc`,
 * `日` -> `~E6~97~A5`). Git refs cannot contain `~`, so an escape never reads as characters a ref wrote literally.
 */
function escapeSlotChar(char: string): string {
  return [...new TextEncoder().encode(char)].map((byte) => `~${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}

/**
 * Sanitize a git ref into a slot name: a single path segment that is safe as a directory name and as
 * a URL, and never the name of a root entry the action owns. Implements D-04/D-06 and mitigates
 * T-01-01 (path traversal via ref name). Idempotent: a slot name sanitizes to itself.
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

  // Escape every other non-slot character. A leading dot would make a hidden or relative (`.`)
  // directory, so leading dots go with leading hyphens.
  const safe = joined
    .replace(NON_SLOT_CHARS, escapeSlotChar)
    .replace(/-+/g, '-')
    .replace(/^[-.]+|-$/g, '');

  if (safe.length === 0) {
    throw new Error(`Ref "${ref}" sanitized to an empty string`);
  }
  // A name the action owns at the root has its first character escaped (`_versions` -> `~5Fversions`),
  // so the slot directory sits beside the root entry instead of on it.
  return ROOT_ENTRY_NAMES.has(safe.toLowerCase()) ? escapeSlotChar(safe[0]) + safe.slice(1) : safe;
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
  // [LAW:dataflow-not-control-flow] version is data: when present, it IS the slot; when absent,
  //   the slot is derived from ref. sanitizeRef() is applied unconditionally to whichever input
  //   wins, because path-safety is an invariant we enforce regardless of the source (T-01-01).
  // Ref-pattern filtering is also data-driven: it exists to stop accidental deploys from the
  //   wrong ref. An explicit version is an explicit decision to deploy, so filtering is bypassed
  //   by encoding "explicit version deploys always match" in the match input.
  const hasExplicitVersion = config.version.length > 0;
  const versionSlot = sanitizeRef(hasExplicitVersion ? config.version : config.ref);

  if (!hasExplicitVersion && !matchesPatterns(versionSlot, config.refPatterns)) {
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
