import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { injectStorageWrapperIntoDir } from '../src/storage-wrapper-injector.js';
import { STORAGE_WRAPPER_MARKER } from '../src/storage-wrapper.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sw-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('injectStorageWrapperIntoDir', () => {
  it('injects wrapper script tag into every HTML file', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await writeFile(path.join(dir, 'docs', 'api.html'), '<html><head></head><body></body></html>');

    const count = await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' });
    expect(count).toBe(2);

    const root = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(root).toContain(STORAGE_WRAPPER_MARKER);
    expect(root).toContain('<script>');
    expect(root).toContain('gh-pm:o/r/v1:');

    const nested = await readFile(path.join(dir, 'docs', 'api.html'), 'utf8');
    expect(nested).toContain(STORAGE_WRAPPER_MARKER);
  });

  it('is a no-op when opts is undefined (disabled-as-data)', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    const count = await injectStorageWrapperIntoDir(dir, undefined);
    expect(count).toBe(0);
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).not.toContain(STORAGE_WRAPPER_MARKER);
  });

  it('is idempotent — running twice does not double-inject', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' });
    const first = await readFile(path.join(dir, 'index.html'), 'utf8');
    const secondCount = await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' });
    expect(secondCount).toBe(0);
    const second = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(second).toBe(first);
    // Exactly one marker present
    expect(second.match(new RegExp(STORAGE_WRAPPER_MARKER, 'g'))).toHaveLength(1);
  });

  it('injects at the very start of <head> (before other content)', async () => {
    await writeFile(
      path.join(dir, 'index.html'),
      '<html><head><title>app</title><script>console.log(localStorage.foo)</script></head><body></body></html>',
    );
    await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' });
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    const headOpenIdx = html.indexOf('<head>');
    const markerIdx = html.indexOf(STORAGE_WRAPPER_MARKER);
    const titleIdx = html.indexOf('<title>');
    // Our script is between <head> and <title> — it runs before any user script
    expect(headOpenIdx).toBeLessThan(markerIdx);
    expect(markerIdx).toBeLessThan(titleIdx);
  });

  it('handles HTML with no <head> by wrapping one', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><body>hi</body></html>');
    await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' });
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<head>');
    expect(html).toContain(STORAGE_WRAPPER_MARKER);
  });

  it('returns 0 for directory with no HTML files', async () => {
    await writeFile(path.join(dir, 'not-html.txt'), 'x');
    expect(await injectStorageWrapperIntoDir(dir, { namespace: 'gh-pm:o/r/v1:' })).toBe(0);
  });

  it('returns 0 for missing directory (walk yields empty)', async () => {
    expect(
      await injectStorageWrapperIntoDir(path.join(dir, 'missing'), { namespace: 'gh-pm:o/r/v1:' }),
    ).toBe(0);
  });
});
