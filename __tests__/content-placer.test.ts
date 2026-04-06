import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { placeContent } from '../src/content-placer.js';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DeploymentContext } from '../src/types.js';

let workdir: string;
let sourceDir: string;

const context = (versionSlot = 'v1'): DeploymentContext => ({
  versionSlot,
  originalRef: `refs/tags/${versionSlot}`,
  sha: 'abc',
  timestamp: '2026-04-06T00:00:00Z',
  basePath: `/repo/${versionSlot}/`,
});

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'cp-work-'));
  sourceDir = await mkdtemp(path.join(tmpdir(), 'cp-src-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

describe('placeContent', () => {
  it('copies sourceDir contents into workdir/versionSlot/', async () => {
    await writeFile(path.join(sourceDir, 'index.html'), '<html><head></head></html>');
    await writeFile(path.join(sourceDir, 'style.css'), 'body{}');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');
    expect((await stat(path.join(workdir, 'v1', 'index.html'))).isFile()).toBe(true);
    expect((await stat(path.join(workdir, 'v1', 'style.css'))).isFile()).toBe(true);
  });

  it('applies base-tag injection to .html files', async () => {
    await writeFile(path.join(sourceDir, 'index.html'), '<html><head><title>T</title></head></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');
    const html = await readFile(path.join(workdir, 'v1', 'index.html'), 'utf8');
    expect(html).toContain('<base href="/repo/v1/">');
  });

  it('applies URL rewriting in rewrite mode', async () => {
    await writeFile(path.join(sourceDir, 'index.html'), '<html><head></head><body><img src="/img.png"></body></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'rewrite');
    const html = await readFile(path.join(workdir, 'v1', 'index.html'), 'utf8');
    expect(html).toContain('src="/repo/v1/img.png"');
  });

  it('creates .nojekyll at workdir root', async () => {
    await writeFile(path.join(sourceDir, 'index.html'), '<html><head></head></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');
    expect((await stat(path.join(workdir, '.nojekyll'))).isFile()).toBe(true);
  });

  it('preserves existing version directories (DEPL-01)', async () => {
    // Pre-existing v0
    await mkdir(path.join(workdir, 'v0'), { recursive: true });
    await writeFile(path.join(workdir, 'v0', 'old.html'), '<html>old</html>');
    // Pre-existing CNAME at root (Pitfall 5)
    await writeFile(path.join(workdir, 'CNAME'), 'example.com');

    await writeFile(path.join(sourceDir, 'index.html'), '<html><head></head></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');

    expect((await stat(path.join(workdir, 'v0', 'old.html'))).isFile()).toBe(true);
    expect((await stat(path.join(workdir, 'CNAME'))).isFile()).toBe(true);
    expect((await stat(path.join(workdir, 'v1', 'index.html'))).isFile()).toBe(true);
  });

  it('replaces contents of an existing version slot (idempotent redeploy)', async () => {
    await mkdir(path.join(workdir, 'v1'), { recursive: true });
    await writeFile(path.join(workdir, 'v1', 'stale.html'), '<html>stale</html>');

    await writeFile(path.join(sourceDir, 'index.html'), '<html><head></head></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');

    await expect(stat(path.join(workdir, 'v1', 'stale.html'))).rejects.toThrow();
    expect((await stat(path.join(workdir, 'v1', 'index.html'))).isFile()).toBe(true);
  });

  it('applies base path correction to nested .html files', async () => {
    await mkdir(path.join(sourceDir, 'sub'), { recursive: true });
    await writeFile(path.join(sourceDir, 'sub', 'page.html'), '<html><head></head></html>');
    await placeContent(workdir, sourceDir, context('v1'), 'base-tag');
    const html = await readFile(path.join(workdir, 'v1', 'sub', 'page.html'), 'utf8');
    expect(html).toContain('<base href="/repo/v1/">');
  });
});
