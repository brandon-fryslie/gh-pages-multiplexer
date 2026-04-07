// [LAW:behavior-not-structure] Tests assert behavior (sanitization outputs, pattern matching, context shape), not implementation details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeRef, matchesPatterns, resolveContext } from '../src/ref-resolver.js';
import type { DeployConfig } from '../src/types.js';

const baseConfig = (overrides: Partial<DeployConfig> = {}): DeployConfig => ({
  sourceDir: 'dist',
  targetBranch: 'gh-pages',
  refPatterns: ['*'],
  basePathMode: 'base-tag',
  basePathPrefix: '',
  token: 'x',
  repo: 'owner/my-repo',
  ref: 'refs/heads/main',
  version: '',
  widgetIcon: '',
  widgetLabel: '',
  widgetPosition: '',
  widgetColor: '',
  ...overrides,
});

describe('sanitizeRef', () => {
  it('strips refs/tags/ prefix', () => {
    expect(sanitizeRef('refs/tags/v2.1.0')).toBe('v2.1.0');
  });

  it('converts refs/heads/feature/auth to feature-auth', () => {
    expect(sanitizeRef('refs/heads/feature/auth')).toBe('feature-auth');
  });

  it('converts deeply nested heads to hyphenated', () => {
    expect(sanitizeRef('refs/heads/feature/deep/nested')).toBe('feature-deep-nested');
  });

  it('converts refs/pull/42/merge to pr-42', () => {
    expect(sanitizeRef('refs/pull/42/merge')).toBe('pr-42');
  });

  it('returns bare main branch name', () => {
    expect(sanitizeRef('refs/heads/main')).toBe('main');
  });

  it('strips .. path traversal segments', () => {
    // [LAW:single-enforcer] ref sanitization is the single enforcement point for filesystem-safe names (T-01-01).
    const out = sanitizeRef('refs/heads/../etc/passwd');
    expect(out).not.toContain('..');
    expect(out).toBe('etc-passwd');
  });

  it('strips null bytes and control characters', () => {
    const out = sanitizeRef('refs/heads/foo\u0000bar\u0001baz');
    expect(out).not.toContain('\u0000');
    expect(out).not.toContain('\u0001');
    expect(out).toBe('foobarbaz');
  });

  it('never starts or ends with a hyphen', () => {
    const out = sanitizeRef('refs/heads/-weird-');
    expect(out.startsWith('-')).toBe(false);
    expect(out.endsWith('-')).toBe(false);
  });

  it('result never contains a slash', () => {
    expect(sanitizeRef('refs/heads/a/b/c/d')).not.toContain('/');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeRef('refs/heads/foo///bar')).toBe('foo-bar');
  });

  it('throws on empty result', () => {
    expect(() => sanitizeRef('refs/heads/---')).toThrow();
  });
});

describe('matchesPatterns', () => {
  it('matches v2.1.0 against v*', () => {
    expect(matchesPatterns('v2.1.0', ['v*'])).toBe(true);
  });

  it('does not match feature-auth against v*', () => {
    expect(matchesPatterns('feature-auth', ['v*'])).toBe(false);
  });

  it('matches anything against *', () => {
    expect(matchesPatterns('feature-auth', ['*'])).toBe(true);
  });

  it('matches if any pattern matches', () => {
    expect(matchesPatterns('v2.1.0', ['v*', 'release-*'])).toBe(true);
  });

  it('empty patterns matches all', () => {
    expect(matchesPatterns('pr-42', [])).toBe(true);
  });
});

describe('resolveContext', () => {
  beforeEach(() => {
    process.env.GITHUB_SHA = 'deadbeef';
  });
  afterEach(() => {
    delete process.env.GITHUB_SHA;
  });

  it('computes versionSlot and basePath for project site', () => {
    const ctx = resolveContext(baseConfig({ ref: 'refs/tags/v2.1.0' }));
    expect(ctx.versionSlot).toBe('v2.1.0');
    expect(ctx.basePath).toBe('/my-repo/v2.1.0/');
    expect(ctx.originalRef).toBe('refs/tags/v2.1.0');
    expect(ctx.sha).toBe('deadbeef');
    expect(ctx.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('uses basePathPrefix override when provided', () => {
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/tags/v1', basePathPrefix: 'custom-prefix' })
    );
    expect(ctx.basePath).toBe('/custom-prefix/v1/');
  });

  it('user site (*.github.io) computes basePath without repo prefix', () => {
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/tags/v1', repo: 'owner/owner.github.io' })
    );
    expect(ctx.basePath).toBe('/v1/');
  });

  it('custom domain (cname=true) computes basePath without repo prefix', () => {
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/tags/v1' }),
      true
    );
    expect(ctx.basePath).toBe('/v1/');
  });

  it('throws when ref does not match patterns', () => {
    expect(() =>
      resolveContext(baseConfig({ ref: 'refs/heads/feature-x', refPatterns: ['v*'] }))
    ).toThrow(/does not match/);
  });

  it('explicit version overrides ref-derived slot', () => {
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/heads/main', version: 'v1.2.3' })
    );
    expect(ctx.versionSlot).toBe('v1.2.3');
    expect(ctx.basePath).toBe('/my-repo/v1.2.3/');
    expect(ctx.originalRef).toBe('refs/heads/main');
  });

  it('explicit version bypasses ref-pattern filtering', () => {
    // Ref is main, patterns only allow v* — would normally throw.
    // Explicit version short-circuits the filter.
    const ctx = resolveContext(
      baseConfig({
        ref: 'refs/heads/main',
        refPatterns: ['v*'],
        version: 'explicit-slot',
      })
    );
    expect(ctx.versionSlot).toBe('explicit-slot');
  });

  it('explicit version is still sanitized for path safety', () => {
    // Even though the caller claims ownership, path-traversal is a hard invariant.
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/heads/main', version: '../../../etc/passwd' })
    );
    expect(ctx.versionSlot).toBe('etc-passwd');
    expect(ctx.versionSlot).not.toContain('..');
    expect(ctx.versionSlot).not.toContain('/');
  });

  it('empty version field falls back to ref-derived slot', () => {
    const ctx = resolveContext(
      baseConfig({ ref: 'refs/tags/v3.0.0', version: '' })
    );
    expect(ctx.versionSlot).toBe('v3.0.0');
  });
});
