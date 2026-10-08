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
  groupPageCopies,
  injectCanonicalTags,
  sitemapCoverage,
  injectNoindexIntoDir,
} from '../src/seo-injector.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seo-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('groupPageCopies', () => {
  it('lists every version that has a page path, newest first, so the newest copy is canonical', () => {
    const copies = groupPageCopies([
      { slot: 'v3', pages: ['index.html'] },
      { slot: 'v2', pages: ['index.html', 'docs/old.html'] },
      { slot: 'v1', pages: ['index.html', 'docs/old.html', 'docs/older.html'] },
    ]);
    expect(copies).toEqual([
      { page: 'index.html', versions: ['v3', 'v2', 'v1'] },
      { page: 'docs/old.html', versions: ['v2', 'v1'] },
      { page: 'docs/older.html', versions: ['v1'] },
    ]);
  });

  it('has no copies when there are no non-PR versions', () => {
    expect(groupPageCopies([])).toEqual([]);
  });
});

describe('sitemapCoverage', () => {
  it('counts one URL per page path, and those whose canonical copy is older than the latest', () => {
    const copies = groupPageCopies([
      { slot: 'v2', pages: ['index.html'] },
      { slot: 'v1', pages: ['index.html', 'docs/old.html'] },
    ]);
    expect(sitemapCoverage('v2', copies)).toEqual({ latest: 'v2', urls: 2, fromOlderVersions: 1 });
  });

  it('reports no latest and zero URLs when no non-PR version exists', () => {
    expect(sitemapCoverage(null, [])).toEqual({ latest: null, urls: 0, fromOlderVersions: 0 });
  });
});

describe('injectCanonicalTags', () => {
  const page = '<html><head><title>x</title></head><body>hi</body></html>';
  async function writePage(slot: string, rel: string, html = page): Promise<string> {
    const file = path.join(dir, slot, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    return file;
  }
  const copy = (page: string, ...versions: [string, ...string[]]) => ({ page, versions });

  it('points every copy of a page at its canonical copy, including the canonical copy itself', async () => {
    const files = [await writePage('v2.0.0', 'index.html'), await writePage('v1', 'index.html')];
    expect(await injectCanonicalTags(dir, 'https://example.com', [copy('index.html', 'v2.0.0', 'v1')])).toBe(2);
    for (const file of files) {
      const html = await readFile(file, 'utf8');
      expect(html).toContain(CANONICAL_MARKER);
      expect(html).toContain('<link rel="canonical" href="https://example.com/v2.0.0/index.html">');
    }
  });

  it('uses relative path in canonical URL for nested files', async () => {
    const file = await writePage('v1', 'docs/api.html');
    await writePage('v2', 'docs/api.html');
    await injectCanonicalTags(dir, 'https://example.com', [copy('docs/api.html', 'v2', 'v1')]);
    expect(await readFile(file, 'utf8')).toContain('<link rel="canonical" href="https://example.com/v2/docs/api.html">');
  });

  it('repoints a page at its newest remaining copy when the canonical version drops it', async () => {
    const file = await writePage('v1', 'old.html');
    await writePage('v2', 'old.html');
    await injectCanonicalTags(dir, 'https://example.com', [copy('old.html', 'v2', 'v1')]);
    await rm(path.join(dir, 'v2'), { recursive: true });
    await injectCanonicalTags(dir, 'https://example.com', [copy('old.html', 'v1')]);
    const html = await readFile(file, 'utf8');
    expect(html).toContain('https://example.com/v1/old.html');
    expect(html).not.toContain('https://example.com/v2/old.html');
    expect(html.match(new RegExp(CANONICAL_MARKER, 'g'))).toHaveLength(1);
  });

  it('is idempotent — running twice leaves file unchanged', async () => {
    const file = await writePage('v1', 'index.html');
    await injectCanonicalTags(dir, 'https://example.com', [copy('index.html', 'v1')]);
    const first = await readFile(file, 'utf8');
    expect(await injectCanonicalTags(dir, 'https://example.com', [copy('index.html', 'v1')])).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(first);
  });

  it('respects user-authored canonical tags', async () => {
    const original = '<html><head><link rel="canonical" href="https://mysite.com/my-own-url"></head><body></body></html>';
    const file = await writePage('v1', 'index.html', original);
    expect(await injectCanonicalTags(dir, 'https://example.com', [copy('index.html', 'v1')])).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('writes nothing when there are no copies', async () => {
    expect(await injectCanonicalTags(dir, 'https://example.com', [])).toBe(0);
  });

  it('percent-encodes page names in the canonical URL; the slot name is URL-safe as written', async () => {
    const file = await writePage('v1-beta', 'my docs/faq#1.html');
    await injectCanonicalTags(dir, 'https://example.com/repo', [copy('my docs/faq#1.html', 'v1-beta')]);
    expect(await readFile(file, 'utf8')).toContain('<link rel="canonical" href="https://example.com/repo/v1-beta/my%20docs/faq%231.html">');
  });

  it('escapes quotes in URLs', async () => {
    const file = await writePage('v1', 'index.html');
    await injectCanonicalTags(dir, 'https://example.com/"evil', [copy('index.html', 'v1')]);
    const html = await readFile(file, 'utf8');
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
