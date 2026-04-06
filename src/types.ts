// [LAW:one-source-of-truth] Shared data contracts for the entire deployment pipeline.
// All pipeline stages consume and produce instances of these types.

/** Configuration parsed from action inputs */
export interface DeployConfig {
  sourceDir: string;
  targetBranch: string;
  refPatterns: string[];
  basePathMode: 'base-tag' | 'rewrite';
  basePathPrefix: string; // empty string means auto-detect
  token: string;
  repo: string; // owner/repo from GITHUB_REPOSITORY
  ref: string; // full ref from GITHUB_REF
}

/** Context derived from the git ref */
export interface DeploymentContext {
  versionSlot: string; // sanitized directory name (e.g., "v2.1.0", "feature-auth")
  originalRef: string; // original git ref (e.g., "refs/tags/v2.1.0")
  sha: string; // commit SHA
  timestamp: string; // ISO 8601 deploy timestamp
  basePath: string; // computed base path (e.g., "/repo-name/v2.1.0/")
}

/** A single version entry in the manifest */
export interface ManifestEntry {
  version: string; // sanitized directory name
  ref: string; // original git ref
  sha: string; // commit SHA at deploy time
  timestamp: string; // ISO 8601 deploy timestamp
}

/** The versions.json top-level structure */
export interface Manifest {
  schema: 1;
  versions: ManifestEntry[];
}

/** Result returned from the deploy pipeline */
export interface DeployResult {
  version: string;
  url: string;
}
