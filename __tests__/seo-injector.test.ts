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
  const page = '<html><head><title>x</title></head><body>hi</body></html>';
  const latest = (slot: string, ...pages: string[]) => ({ slot, pages: new Set(pages) });
  async function writePage(slot: string, rel: string, html = page): Promise<string> {
    const file = path.join(dir, slot, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    return file;
  }

  it('points a page at the same page in the canonical slot', async () => {
    const file = await writePage('v1', 'index.html');
    const counts = await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2.0.0', 'index.html'));
    expect(counts).toEqual({ written: 1, selfCanonical: 0 });
    const html = await readFile(file, 'utf8');
    expect(html).toContain(CANONICAL_MARKER);
    expect(html).toContain('<link rel="canonical" href="https://example.com/v2.0.0/index.html">');
  });

  it('uses relative path in canonical URL for nested files', async () => {
    const file = await writePage('v1', 'docs/api.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2', 'docs/api.html'));
    expect(await readFile(file, 'utf8')).toContain('<link rel="canonical" href="https://example.com/v2/docs/api.html">');
  });

  it('points a page the canonical slot does not have at itself', async () => {
    const kept = await writePage('v1', 'index.html');
    const removed = await writePage('v1', 'docs/old.html');
    const counts = await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2', 'index.html'));
    expect(counts).toEqual({ written: 2, selfCanonical: 1 });
    expect(await readFile(kept, 'utf8')).toContain('<link rel="canonical" href="https://example.com/v2/index.html">');
    expect(await readFile(removed, 'utf8')).toContain('<link rel="canonical" href="https://example.com/v1/docs/old.html">');
  });

  it('repoints a page at itself when the canonical slot drops it', async () => {
    const file = await writePage('v1', 'old.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2', 'old.html'));
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v3'));
    const html = await readFile(file, 'utf8');
    expect(html).toContain('https://example.com/v1/old.html');
    expect(html).not.toContain('https://example.com/v2/old.html');
    expect(html.match(new RegExp(CANONICAL_MARKER, 'g'))).toHaveLength(1);
  });

  it('is idempotent — running twice leaves file unchanged', async () => {
    const file = await writePage('v1', 'index.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v1', 'index.html'));
    const first = await readFile(file, 'utf8');
    const second = await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v1', 'index.html'));
    expect(second).toEqual({ written: 0, selfCanonical: 0 });
    expect(await readFile(file, 'utf8')).toBe(first);
  });

  it('updates existing gh-pm canonical when the canonical slot changes', async () => {
    const file = await writePage('v1', 'index.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v1', 'index.html'));
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2', 'index.html'));
    const html = await readFile(file, 'utf8');
    expect(html).toContain('https://example.com/v2/index.html');
    expect(html).not.toContain('https://example.com/v1/index.html');
    // Still has exactly one canonical marker.
    expect(html.match(new RegExp(CANONICAL_MARKER, 'g'))).toHaveLength(1);
  });

  it('respects user-authored canonical tags', async () => {
    const original = '<html><head><link rel="canonical" href="https://mysite.com/my-own-url"></head><body></body></html>';
    const file = await writePage('v1', 'index.html', original);
    const counts = await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2', 'index.html'));
    expect(counts.written).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('writes nothing for a slot with no HTML files', async () => {
    await writePage('v1', 'not-html.txt', 'hello');
    expect(await injectCanonicalIntoDir(dir, 'v1', 'https://example.com', latest('v2'))).toEqual({ written: 0, selfCanonical: 0 });
  });

  it('percent-encodes page names in the canonical URL; the slot name is URL-safe as written', async () => {
    const file = await writePage('v1', 'my docs/faq#1.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com/repo', latest('v1-beta', 'my docs/faq#1.html'));
    expect(await readFile(file, 'utf8')).toContain('<link rel="canonical" href="https://example.com/repo/v1-beta/my%20docs/faq%231.html">');
  });

  it('escapes quotes in URLs', async () => {
    const file = await writePage('v1', 'index.html');
    await injectCanonicalIntoDir(dir, 'v1', 'https://example.com/"evil', latest('v1', 'index.html'));
    const html = await readFile(file, 'utf8');
    expect(html).toContain('&quot;');
    expect(html).not.toMatch(/href="[^"]*"evil/);
  });

  it('writes nothing for a slot with no directory', async () => {
    expect(await injectCanonicalIntoDir(dir, 'missing', 'https://example.com', latest('v1'))).toEqual({ written: 0, selfCanonical: 0 });
  });

  it('propagates fs errors other than a missing slot directory', async () => {
    await writeFile(path.join(dir, 'not-a-dir'), '');
    await expect(injectCanonicalIntoDir(dir, 'not-a-dir', 'https://example.com', latest('v1'))).rejects.toMatchObject({ code: 'ENOTDIR' });
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

  it('returns 0 for a slot with no directory', async () => {
    expect(await injectNoindexIntoDir(path.join(dir, 'missing'))).toBe(0);
  });

  it('propagates fs errors other than a missing slot directory', async () => {
    await writeFile(path.join(dir, 'not-a-dir'), '');
    await expect(injectNoindexIntoDir(path.join(dir, 'not-a-dir'))).rejects.toMatchObject({ code: 'ENOTDIR' });
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
