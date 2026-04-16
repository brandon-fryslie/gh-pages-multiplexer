// [LAW:one-source-of-truth] Health data is a pure projection of the manifest.
//   No separate liveness store — the manifest IS the truth.
// [LAW:dataflow-not-control-flow] renderHealth always runs; empty manifest
//   produces a valid health record with null latest_non_pr and 0 version_count.
import type { Manifest } from './types.js';
import { latestNonPrSlot } from './sitemap-generator.js';

export interface HealthRecord {
  status: 'ok';
  schema: number;
  version_count: number;
  latest_non_pr: string | null;
  latest_deploy_version: string | null;
  latest_deploy_sha: string | null;
  generated_at: string;
}

/**
 * Build a deployment health record. Intended to be served at `/_health.json`
 * for external monitoring (uptime checks, synthetic monitors).
 */
export function renderHealth(manifest: Manifest, generatedAt: string): HealthRecord {
  const latest = manifest.versions[0];
  return {
    status: 'ok',
    schema: manifest.schema,
    version_count: manifest.versions.length,
    latest_non_pr: latestNonPrSlot(manifest),
    latest_deploy_version: latest ? latest.version : null,
    latest_deploy_sha: latest ? latest.sha : null,
    generated_at: generatedAt,
  };
}

/**
 * Serialize a HealthRecord to JSON with a trailing newline.
 */
export function serializeHealth(record: HealthRecord): string {
  return JSON.stringify(record, null, 2) + '\n';
}
