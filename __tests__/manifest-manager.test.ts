import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readManifest, updateManifest, writeManifest } from '../src/manifest-manager.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Manifest, ManifestEntry } from '../src/types.js';

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'mnfst-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const entry = (version: string, ts = '2026-04-06T00:00:00Z'): ManifestEntry => ({
  version,
  ref: `refs/tags/${version}`,
  sha: 'abc',
  timestamp: ts,
});

describe('readManifest', () => {
  it('returns empty manifest when file missing', async () => {
    const m = await readManifest(workdir);
    expect(m).toEqual({ schema: 2, versions: [] });
  });

  it('parses existing valid JSON', async () => {
    const existing: Manifest = { schema: 1, versions: [entry('v1')] };
    await writeFile(path.join(workdir, 'versions.json'), JSON.stringify(existing));
    const m = await readManifest(workdir);
    expect(m.versions).toHaveLength(1);
    expect(m.versions[0].version).toBe('v1');
  });

  it('throws on invalid schema', async () => {
    await writeFile(path.join(workdir, 'versions.json'), JSON.stringify({ schema: 99, versions: [] }));
    await expect(readManifest(workdir)).rejects.toThrow();
  });
});

describe('updateManifest', () => {
  it('prepends new entry (newest first)', () => {
    const m: Manifest = { schema: 1, versions: [entry('v1')] };
    const updated = updateManifest(m, entry('v2'));
    expect(updated.versions[0].version).toBe('v2');
    expect(updated.versions[1].version).toBe('v1');
  });

  it('replaces existing entry with same version (idempotent)', () => {
    const m: Manifest = { schema: 1, versions: [entry('v1', '2026-01-01T00:00:00Z')] };
    const updated = updateManifest(m, entry('v1', '2026-04-06T00:00:00Z'));
    expect(updated.versions).toHaveLength(1);
    expect(updated.versions[0].timestamp).toBe('2026-04-06T00:00:00Z');
  });

  it('does not mutate input manifest', () => {
    const m: Manifest = { schema: 1, versions: [entry('v1')] };
    const snapshot = JSON.stringify(m);
    updateManifest(m, entry('v2'));
    expect(JSON.stringify(m)).toBe(snapshot);
  });

  it('always emits schema: 2', () => {
    const m: Manifest = { schema: 1, versions: [] };
    expect(updateManifest(m, entry('v1')).schema).toBe(2);
  });

  it('preserves commits[] on the inserted entry', () => {
    const m: Manifest = { schema: 2, versions: [] };
    const withCommits: ManifestEntry = {
      ...entry('v1'),
      commits: [
        { sha: 'c1', author_name: 'a', author_email: 'a@x', message: 'm', timestamp: '2026-04-06T00:00:00Z' },
      ],
    };
    const updated = updateManifest(m, withCommits);
    expect(updated.schema).toBe(2);
    expect(updated.versions[0].commits).toHaveLength(1);
    expect(updated.versions[0].commits?.[0].sha).toBe('c1');
  });

  it('accepts schema 2 on read', async () => {
    await writeFile(
      path.join(workdir, 'versions.json'),
      JSON.stringify({ schema: 2, versions: [entry('v1')] }),
    );
    const m = await readManifest(workdir);
    expect(m.schema).toBe(2);
  });
});

describe('writeManifest', () => {
  it('writes formatted JSON', async () => {
    const m: Manifest = { schema: 1, versions: [entry('v1')] };
    await writeManifest(workdir, m);
    const content = await readFile(path.join(workdir, 'versions.json'), 'utf8');
    expect(content).toContain('\n  '); // 2-space indented
    expect(JSON.parse(content)).toEqual(m);
  });
});
