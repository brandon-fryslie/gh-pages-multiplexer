import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  latestNonPrSlot,
  findHtmlFilesRelative,
  renderSitemapXml,
  renderEmptySitemap,
} from '../src/sitemap-generator.js';
import type { Manifest, ManifestEntry } from '../src/types.js';

const e = (version: string, ref = `refs/heads/${version}`): ManifestEntry => ({
  version,
  ref,
  sha: 'abc',
  timestamp: '2026-04-06T00:00:00Z',
});

describe('latestNonPrSlot', () => {
  it('returns the first non-PR version (manifest is newest-first)', () => {
    const m: Manifest = {
      schema: 2,
      versions: [e('pr-42', 'refs/pull/42/merge'), e('v2.0.0'), e('v1.0.0')],
    };
    expect(latestNonPrSlot(m)).toBe('v2.0.0');
  });

  it('returns null when all versions are PRs', () => {
    const m: Manifest = {
      schema: 2,
      versions: [e('pr-1', 'refs/pull/1/merge'), e('pr-2', 'refs/pull/2/merge')],
    };
    expect(latestNonPrSlot(m)).toBeNull();
  });

  it('returns null for empty manifest', () => {
    expect(latestNonPrSlot({ schema: 2, versions: [] })).toBeNull();
  });
});

describe('findHtmlFilesRelative', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sitemap-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds HTML files at the root, sorted', async () => {
    await writeFile(path.join(dir, 'b.html'), '');
    await writeFile(path.join(dir, 'a.html'), '');
    expect(await findHtmlFilesRelative(dir)).toEqual(['a.html', 'b.html']);
  });

  it('finds HTML files in nested directories', async () => {
    await mkdir(path.join(dir, 'docs', 'api'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '');
    await writeFile(path.join(dir, 'docs', 'index.html'), '');
    await writeFile(path.join(dir, 'docs', 'api', 'users.html'), '');
    const result = await findHtmlFilesRelative(dir);
    expect(result).toEqual(['docs/api/users.html', 'docs/index.html', 'index.html']);
  });

  it('ignores non-HTML files', async () => {
    await writeFile(path.join(dir, 'index.html'), '');
    await writeFile(path.join(dir, 'script.js'), '');
    await writeFile(path.join(dir, 'style.css'), '');
    expect(await findHtmlFilesRelative(dir)).toEqual(['index.html']);
  });

  it('returns empty array for missing directory', async () => {
    expect(await findHtmlFilesRelative(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('renderSitemapXml', () => {
  it('emits valid sitemap XML with URLs under the slot', () => {
    const xml = renderSitemapXml(
      'https://example.com',
      'v1.0.0',
      ['index.html', 'docs/api.html'],
      '2026-04-06T12:00:00Z',
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<loc>https://example.com/v1.0.0/index.html</loc>');
    expect(xml).toContain('<loc>https://example.com/v1.0.0/docs/api.html</loc>');
    expect(xml).toContain('<lastmod>2026-04-06</lastmod>');
  });

  it('emits empty urlset when no HTML files provided', () => {
    const xml = renderSitemapXml('https://example.com', 'v1.0.0', [], '2026-04-06T12:00:00Z');
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
  });

  it('escapes special chars in URLs', () => {
    const xml = renderSitemapXml(
      'https://example.com',
      'v1',
      ['search.html?q=foo&bar=baz'],
      '2026-04-06T00:00:00Z',
    );
    expect(xml).toContain('&amp;');
  });
});

describe('renderEmptySitemap', () => {
  it('produces a valid empty urlset', () => {
    const xml = renderEmptySitemap();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).not.toContain('<url>');
  });
});
