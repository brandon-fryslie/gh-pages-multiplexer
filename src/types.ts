// [LAW:one-source-of-truth] Shared data contracts for the entire deployment pipeline.
// All pipeline stages consume and produce instances of these types.

/** Configuration parsed from action inputs */
export interface DeployConfig {
  sourceDir: string;
  targetBranch: string;
  refPatterns: string[];
  // 'none' — caller has already set the correct base URL at build time; skip HTML rewriting entirely.
  basePathMode: 'base-tag' | 'rewrite' | 'none';
  basePathPrefix: string; // empty string means auto-detect
  token: string;
  repo: string; // owner/repo from GITHUB_REPOSITORY
  ref: string; // full ref from GITHUB_REF
  // Explicit version override. When set, this is used as the version slot directly
  // (still sanitized for path safety) and ref-pattern filtering is bypassed. When
  // empty, the version is derived from `ref` via sanitizeRef() as before.
  version: string;
}

/** Context derived from the git ref */
export interface DeploymentContext {
  versionSlot: string; // sanitized directory name (e.g., "v2.1.0", "feature-auth")
  originalRef: string; // original git ref (e.g., "refs/tags/v2.1.0")
  sha: string; // commit SHA
  timestamp: string; // ISO 8601 deploy timestamp
  basePath: string; // computed base path (e.g., "/repo-name/v2.1.0/")
}

// [LAW:one-source-of-truth] META-02/META-03: commit metadata shape lives here,
// as the single definition consumed by extractor, manifest writer, and downstream renderers.
/** A single commit record attached to a deployment */
export interface CommitInfo {
  sha: string; // full 40-char SHA
  author_name: string;
  author_email: string;
  message: string; // full body, untrimmed, may include newlines
  timestamp: string; // ISO 8601 (%aI)
}

/** A single version entry in the manifest */
export interface ManifestEntry {
  version: string; // sanitized directory name
  ref: string; // original git ref
  sha: string; // commit SHA at deploy time
  timestamp: string; // ISO 8601 deploy timestamp
  commits?: CommitInfo[]; // optional on read (schema 1), populated on write (schema 2)
}

/** The versions.json top-level structure */
export interface Manifest {
  // Reader accepts 1 | 2 (D-02). Writer always emits 2.
  schema: 1 | 2;
  versions: ManifestEntry[];
}

/** Result returned from the deploy pipeline */
export interface DeployResult {
  version: string;
  url: string;
}
