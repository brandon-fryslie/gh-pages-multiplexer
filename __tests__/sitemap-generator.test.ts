import { describe, it, expect } from 'vitest';
import {
  latestNonPrSlot,
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

  it('percent-encodes slot and page names in <loc>', () => {
    const xml = renderSitemapXml(
      'https://example.com/repo',
      'v1 beta',
      ['docs/my page.html', 'faq#1.html', 'a&b.html'],
      '2026-04-06T12:00:00Z',
    );
    expect(xml).toContain('<loc>https://example.com/repo/v1%20beta/docs/my%20page.html</loc>');
    expect(xml).toContain('<loc>https://example.com/repo/v1%20beta/faq%231.html</loc>');
    expect(xml).toContain('<loc>https://example.com/repo/v1%20beta/a%26b.html</loc>');
  });

  it('emits empty urlset when no HTML files provided', () => {
    const xml = renderSitemapXml('https://example.com', 'v1.0.0', [], '2026-04-06T12:00:00Z');
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
  });

  it('XML-escapes the site base', () => {
    const xml = renderSitemapXml('https://example.com/a&b', 'v1', ['index.html'], '2026-04-06T00:00:00Z');
    expect(xml).toContain('<loc>https://example.com/a&amp;b/v1/index.html</loc>');
  });
});

describe('renderEmptySitemap', () => {
  it('produces a valid empty urlset', () => {
    const xml = renderEmptySitemap();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).not.toContain('<url>');
  });
});
