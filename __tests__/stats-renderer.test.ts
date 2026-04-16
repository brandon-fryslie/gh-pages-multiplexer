import { describe, it, expect } from 'vitest';
import { renderStatsHtml } from '../src/stats-renderer.js';

describe('renderStatsHtml', () => {
  const repo = { owner: 'acme', repo: 'widgets' };

  it('renders valid HTML with repo heading', () => {
    const html = renderStatsHtml(repo);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>acme/widgets');
    expect(html).toContain('github.com/acme/widgets');
  });

  it('includes client-side fetch of versions.json', () => {
    const html = renderStatsHtml(repo);
    expect(html).toContain("fetch('../versions.json'");
  });

  it('includes empty-state markup that is initially hidden', () => {
    const html = renderStatsHtml(repo);
    expect(html).toMatch(/id="empty-state"[^>]*style="display:none;?"/);
  });

  it('escapes owner/repo names in the HTML', () => {
    const html = renderStatsHtml({ owner: 'a<b>', repo: '"c"' });
    expect(html).not.toContain('<title>a<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&quot;c&quot;');
  });

  it('contains stat placeholders for total/tags/branches/prs', () => {
    const html = renderStatsHtml(repo);
    expect(html).toContain('id="stat-total"');
    expect(html).toContain('id="stat-tags"');
    expect(html).toContain('id="stat-branches"');
    expect(html).toContain('id="stat-prs"');
  });
});
