import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import {
  CANONICAL_MARKER,
  NOINDEX_MARKER,
  injectCanonicalIntoDir,
  injectNoindexIntoDir,
} from '../src/seo-injector.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seo-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('injectCanonicalIntoDir', () => {
  it('injects canonical tag into HTML files', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head><title>x</title></head><body>hi</body></html>');
    const count = await injectCanonicalIntoDir(dir, 'https://example.com/v2.0.0');
    expect(count).toBe(1);
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain(CANONICAL_MARKER);
    expect(html).toContain('<link rel="canonical" href="https://example.com/v2.0.0/index.html">');
  });

  it('uses relative path in canonical URL for nested files', async () => {
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await writeFile(path.join(dir, 'docs', 'api.html'), '<html><head></head><body></body></html>');
    await injectCanonicalIntoDir(dir, 'https://example.com/v1.0.0');
    const html = await readFile(path.join(dir, 'docs', 'api.html'), 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://example.com/v1.0.0/docs/api.html">');
  });

  it('is idempotent — running twice leaves file unchanged', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await injectCanonicalIntoDir(dir, 'https://example.com/v1');
    const first = await readFile(path.join(dir, 'index.html'), 'utf8');
    const secondCount = await injectCanonicalIntoDir(dir, 'https://example.com/v1');
    expect(secondCount).toBe(0);
    const second = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(second).toBe(first);
  });

  it('updates existing gh-pm canonical when base changes', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await injectCanonicalIntoDir(dir, 'https://example.com/v1');
    await injectCanonicalIntoDir(dir, 'https://example.com/v2');
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('https://example.com/v2/index.html');
    expect(html).not.toContain('https://example.com/v1/index.html');
    // Still has exactly one canonical marker.
    expect(html.match(new RegExp(CANONICAL_MARKER, 'g'))).toHaveLength(1);
  });

  it('respects user-authored canonical tags', async () => {
    const original = '<html><head><link rel="canonical" href="https://mysite.com/my-own-url"></head><body></body></html>';
    await writeFile(path.join(dir, 'index.html'), original);
    const count = await injectCanonicalIntoDir(dir, 'https://example.com/v1');
    expect(count).toBe(0);
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toBe(original);
  });

  it('returns 0 for directory with no HTML files', async () => {
    await writeFile(path.join(dir, 'not-html.txt'), 'hello');
    expect(await injectCanonicalIntoDir(dir, 'https://example.com/v1')).toBe(0);
  });

  it('escapes quotes in URLs', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await injectCanonicalIntoDir(dir, 'https://example.com/v1"evil');
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('&quot;');
    expect(html).not.toMatch(/href="[^"]*"evil/);
  });
});

describe('injectNoindexIntoDir', () => {
  it('injects noindex meta tag into PR HTML files', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    const count = await injectNoindexIntoDir(dir);
    expect(count).toBe(1);
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain(NOINDEX_MARKER);
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it('is idempotent', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    await injectNoindexIntoDir(dir);
    const secondCount = await injectNoindexIntoDir(dir);
    expect(secondCount).toBe(0);
  });

  it('returns 0 when directory has no HTML files', async () => {
    expect(await injectNoindexIntoDir(dir)).toBe(0);
  });

  it('injects after <head> opening tag', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head><title>x</title></head><body></body></html>');
    await injectNoindexIntoDir(dir);
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    const headIdx = html.indexOf('<head>');
    const noindexIdx = html.indexOf(NOINDEX_MARKER);
    const titleIdx = html.indexOf('<title>');
    expect(headIdx).toBeLessThan(noindexIdx);
    expect(noindexIdx).toBeLessThan(titleIdx);
  });
});
