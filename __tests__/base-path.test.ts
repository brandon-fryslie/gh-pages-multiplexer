import { describe, it, expect } from 'vitest';
import { injectBaseHref, rewriteUrls } from '../src/base-path.js';

describe('injectBaseHref', () => {
  it('inserts <base href> after <head>', () => {
    const out = injectBaseHref('<html><head><title>T</title></head></html>', '/repo/v1/', 'index.html');
    expect(out).toContain('<base href="/repo/v1/">');
    expect(out.indexOf('<base')).toBeGreaterThan(out.indexOf('<head>'));
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'));
  });

  it('replaces existing <base href>', () => {
    const out = injectBaseHref('<html><head><base href="/"><title>T</title></head></html>', '/repo/v1/', 'index.html');
    expect(out).toContain('<base href="/repo/v1/">');
    expect(out).not.toContain('<base href="/">');
    // No duplicate base tags
    expect(out.match(/<base /g)?.length).toBe(1);
  });

  it('rewrites fragment-only href to include filename', () => {
    const out = injectBaseHref(
      '<html><head></head><body><a href="#section">s</a></body></html>',
      '/repo/v1/',
      'about.html'
    );
    expect(out).toContain('href="about.html#section"');
    expect(out).not.toContain('href="#section"');
  });

  it('returns HTML unchanged when no <head>', () => {
    const input = '<div>no head here</div>';
    expect(injectBaseHref(input, '/repo/v1/', 'index.html')).toBe(input);
  });
});

describe('rewriteUrls', () => {
  it('rewrites src="/img.png"', () => {
    expect(rewriteUrls('<img src="/img.png">', '/repo/v1/')).toBe('<img src="/repo/v1/img.png">');
  });

  it('rewrites href="/page.html"', () => {
    expect(rewriteUrls('<a href="/page.html">x</a>', '/repo/v1/')).toBe('<a href="/repo/v1/page.html">x</a>');
  });

  it('does not rewrite absolute https URLs', () => {
    const input = '<a href="https://external.com/x">x</a>';
    expect(rewriteUrls(input, '/repo/v1/')).toBe(input);
  });

  it('does not rewrite protocol-relative URLs', () => {
    const input = '<a href="//cdn.example.com/x">x</a>';
    expect(rewriteUrls(input, '/repo/v1/')).toBe(input);
  });

  it('does not rewrite relative paths', () => {
    const input = '<a href="page.html">x</a>';
    expect(rewriteUrls(input, '/repo/v1/')).toBe(input);
  });
});
