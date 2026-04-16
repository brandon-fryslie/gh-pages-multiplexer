import { describe, it, expect } from 'vitest';
import { renderRobotsTxt } from '../src/robots-generator.js';
import type { Manifest, ManifestEntry } from '../src/types.js';

const e = (version: string, ref = `refs/heads/${version}`): ManifestEntry => ({
  version,
  ref,
  sha: 'abc',
  timestamp: '2026-04-06T00:00:00Z',
});

describe('renderRobotsTxt', () => {
  it('allow-all when manifest has no PR versions', () => {
    const manifest: Manifest = { schema: 2, versions: [e('v1.0.0'), e('main')] };
    const txt = renderRobotsTxt(manifest, '/repo/');
    expect(txt).toContain('User-agent: *');
    expect(txt).not.toContain('Disallow:');
  });

  it('disallows each PR version directory', () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [e('v1.0.0'), e('pr-42', 'refs/pull/42/merge'), e('pr-7', 'refs/pull/7/merge')],
    };
    const txt = renderRobotsTxt(manifest, '/repo/');
    expect(txt).toContain('Disallow: /repo/pr-42/');
    expect(txt).toContain('Disallow: /repo/pr-7/');
    expect(txt).not.toContain('Disallow: /repo/v1.0.0/');
    expect(txt).not.toContain('Disallow: /repo/main/');
  });

  it('handles custom domain (root siteRoot)', () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [e('pr-99', 'refs/pull/99/merge')],
    };
    const txt = renderRobotsTxt(manifest, '/');
    expect(txt).toContain('Disallow: /pr-99/');
  });

  it('normalizes siteRoot without leading/trailing slashes', () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [e('pr-1', 'refs/pull/1/merge')],
    };
    expect(renderRobotsTxt(manifest, 'repo')).toContain('Disallow: /repo/pr-1/');
    expect(renderRobotsTxt(manifest, '/repo')).toContain('Disallow: /repo/pr-1/');
    expect(renderRobotsTxt(manifest, 'repo/')).toContain('Disallow: /repo/pr-1/');
  });

  it('empty manifest produces valid allow-all robots.txt', () => {
    const txt = renderRobotsTxt({ schema: 2, versions: [] }, '/repo/');
    expect(txt).toBe('User-agent: *\n');
  });
});
