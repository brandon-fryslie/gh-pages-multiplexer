// Integration test: exercises the pure-logic pipeline stages against a real
// filesystem workdir to prove that manifest + version content are co-located
// under the same root at the moment commitAndPush would run -- i.e. they would
// be captured by a single `git add -A` and land in a single commit (MNFST-04 atomic).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock @actions/core because the stage modules import it for info/warning logging.
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));

import { readManifest, updateManifest, writeManifest } from '../src/manifest-manager.js';
import { placeContent } from '../src/content-placer.js';
import type { DeploymentContext, ManifestEntry } from '../src/types.js';

let workdir: string;
let sourceDir: string;

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'deploy-wd-'));
  sourceDir = await mkdtemp(path.join(tmpdir(), 'deploy-src-'));
  await writeFile(
    path.join(sourceDir, 'index.html'),
    '<html><head></head><body>hi</body></html>',
    'utf8',
  );
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

describe('deploy pipeline integration', () => {
  it('manifest and content are co-located for atomic commit', async () => {
    const context: DeploymentContext = {
      versionSlot: 'v1.0.0',
      originalRef: 'refs/tags/v1.0.0',
      sha: 'abc123',
      timestamp: '2026-04-06T00:00:00Z',
      basePath: '/repo/v1.0.0/',
    };

    // Stage 3: read -> update -> write manifest.
    const current = await readManifest(workdir);
    expect(current).toEqual({ schema: 2, versions: [] });

    const entry: ManifestEntry = {
      version: context.versionSlot,
      ref: context.originalRef,
      sha: context.sha,
      timestamp: context.timestamp,
    };
    const updated = updateManifest(current, entry);
    await writeManifest(workdir, updated);

    // Stage 4: place content.
    await placeContent(workdir, sourceDir, context, 'base-tag');

    // Both artifacts must exist under the same workdir root -- that's what
    // atomic means at the filesystem level: a single `git add -A` in this
    // workdir captures both the new manifest and the new version directory.
    const manifestPath = path.join(workdir, 'versions.json');
    const versionDirPath = path.join(workdir, 'v1.0.0');
    const versionIndexPath = path.join(versionDirPath, 'index.html');

    await expect(stat(manifestPath)).resolves.toBeTruthy();
    await expect(stat(versionDirPath)).resolves.toBeTruthy();
    await expect(stat(versionIndexPath)).resolves.toBeTruthy();

    // Manifest content reflects the update.
    const manifestRaw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.schema).toBe(2);
    expect(manifest.versions[0]).toEqual(entry);

    // Base-tag correction was applied to the HTML file.
    const html = await readFile(versionIndexPath, 'utf8');
    expect(html).toContain('<base href="/repo/v1.0.0/">');

    // .nojekyll was created at workdir root (Pitfall 4).
    await expect(stat(path.join(workdir, '.nojekyll'))).resolves.toBeTruthy();
  });

  it('preserves existing sibling version directories on redeploy of another slot', async () => {
    // Simulate an existing previous deploy sitting in the worktree.
    await mkdir(path.join(workdir, 'v0.9.0'), { recursive: true });
    await writeFile(path.join(workdir, 'v0.9.0', 'index.html'), 'old', 'utf8');
    await writeFile(
      path.join(workdir, 'versions.json'),
      JSON.stringify({
        schema: 1,
        versions: [
          { version: 'v0.9.0', ref: 'refs/tags/v0.9.0', sha: 'deadbeef', timestamp: '2026-01-01T00:00:00Z' },
        ],
      }),
      'utf8',
    );

    const context: DeploymentContext = {
      versionSlot: 'v1.0.0',
      originalRef: 'refs/tags/v1.0.0',
      sha: 'abc123',
      timestamp: '2026-04-06T00:00:00Z',
      basePath: '/repo/v1.0.0/',
    };

    const current = await readManifest(workdir);
    const updated = updateManifest(current, {
      version: 'v1.0.0',
      ref: 'refs/tags/v1.0.0',
      sha: 'abc123',
      timestamp: '2026-04-06T00:00:00Z',
    });
    await writeManifest(workdir, updated);
    await placeContent(workdir, sourceDir, context, 'base-tag');

    // Old slot still exists untouched (DEPL-01).
    await expect(stat(path.join(workdir, 'v0.9.0', 'index.html'))).resolves.toBeTruthy();
    // New slot exists.
    await expect(stat(path.join(workdir, 'v1.0.0', 'index.html'))).resolves.toBeTruthy();
    // Manifest has both, newest first.
    const manifest = JSON.parse(await readFile(path.join(workdir, 'versions.json'), 'utf8'));
    expect(manifest.versions.map((v: { version: string }) => v.version)).toEqual(['v1.0.0', 'v0.9.0']);
  });
});
