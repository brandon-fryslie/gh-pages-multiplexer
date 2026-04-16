import { describe, it, expect } from 'vitest';
import { renderHealth, serializeHealth } from '../src/health-generator.js';
import type { Manifest, ManifestEntry } from '../src/types.js';

const e = (version: string, sha = 'abc', ref = `refs/heads/${version}`): ManifestEntry => ({
  version,
  ref,
  sha,
  timestamp: '2026-04-06T00:00:00Z',
});

describe('renderHealth', () => {
  it('reports manifest summary for a populated manifest', () => {
    const m: Manifest = {
      schema: 2,
      versions: [e('pr-42', 'sha-pr', 'refs/pull/42/merge'), e('v1.0.0', 'sha-v1')],
    };
    const h = renderHealth(m, '2026-04-16T00:00:00Z');
    expect(h.status).toBe('ok');
    expect(h.schema).toBe(2);
    expect(h.version_count).toBe(2);
    expect(h.latest_non_pr).toBe('v1.0.0');
    expect(h.latest_deploy_version).toBe('pr-42');
    expect(h.latest_deploy_sha).toBe('sha-pr');
    expect(h.generated_at).toBe('2026-04-16T00:00:00Z');
  });

  it('handles empty manifest', () => {
    const h = renderHealth({ schema: 2, versions: [] }, '2026-04-16T00:00:00Z');
    expect(h.version_count).toBe(0);
    expect(h.latest_non_pr).toBeNull();
    expect(h.latest_deploy_version).toBeNull();
    expect(h.latest_deploy_sha).toBeNull();
  });

  it('latest_non_pr is null when all versions are PRs', () => {
    const m: Manifest = {
      schema: 2,
      versions: [e('pr-1', 'sha-1', 'refs/pull/1/merge'), e('pr-2', 'sha-2', 'refs/pull/2/merge')],
    };
    expect(renderHealth(m, '2026-04-16T00:00:00Z').latest_non_pr).toBeNull();
  });
});

describe('serializeHealth', () => {
  it('produces pretty-printed JSON with trailing newline', () => {
    const h = renderHealth({ schema: 2, versions: [] }, '2026-04-16T00:00:00Z');
    const json = serializeHealth(h);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(h);
    expect(json).toContain('  '); // indented
  });
});
