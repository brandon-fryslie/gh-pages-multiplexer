import { describe, it, expect, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { tagNameFromRef, fetchReleaseForRef, type ReleaseOctokit } from '../src/release-fetcher.js';

describe('tagNameFromRef', () => {
  it('extracts tag name from refs/tags/ ref', () => {
    expect(tagNameFromRef('refs/tags/v1.2.3')).toBe('v1.2.3');
    expect(tagNameFromRef('refs/tags/release/2026-04-16')).toBe('release/2026-04-16');
  });

  it('returns null for non-tag refs', () => {
    expect(tagNameFromRef('refs/heads/main')).toBeNull();
    expect(tagNameFromRef('refs/pull/42/merge')).toBeNull();
    expect(tagNameFromRef('')).toBeNull();
  });
});

function mockOctokit(
  handler: (params: { owner: string; repo: string; tag: string }) => Promise<{ data: unknown }>,
): ReleaseOctokit {
  return {
    rest: {
      repos: {
        getReleaseByTag: handler as never,
      },
    },
  };
}

describe('fetchReleaseForRef', () => {
  it('returns null for non-tag ref (no API call)', async () => {
    const getByTag = vi.fn();
    const octokit: ReleaseOctokit = { rest: { repos: { getReleaseByTag: getByTag as never } } };
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/heads/main');
    expect(result).toBeNull();
    expect(getByTag).not.toHaveBeenCalled();
  });

  it('returns release info when API returns a release', async () => {
    const octokit = mockOctokit(async () => ({
      data: {
        name: 'Version 1.2.3',
        body: 'Release notes body',
        html_url: 'https://github.com/o/r/releases/tag/v1.2.3',
        published_at: '2026-04-16T12:00:00Z',
        prerelease: false,
        tag_name: 'v1.2.3',
      },
    }));
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/tags/v1.2.3');
    expect(result).toEqual({
      name: 'Version 1.2.3',
      body: 'Release notes body',
      url: 'https://github.com/o/r/releases/tag/v1.2.3',
      published_at: '2026-04-16T12:00:00Z',
      prerelease: false,
    });
  });

  it('falls back to tag_name when release name is missing', async () => {
    const octokit = mockOctokit(async () => ({
      data: {
        name: null,
        body: null,
        html_url: 'https://example.com',
        published_at: null,
        prerelease: false,
        tag_name: 'v1.2.3',
      },
    }));
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/tags/v1.2.3');
    expect(result?.name).toBe('v1.2.3');
    expect(result?.body).toBe('');
    expect(result?.published_at).toBe('');
  });

  it('returns null on 404', async () => {
    const octokit = mockOctokit(async () => {
      const err: Error & { status?: number } = new Error('Not Found');
      err.status = 404;
      throw err;
    });
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/tags/v1.2.3');
    expect(result).toBeNull();
  });

  it('returns null on other errors (warning logged)', async () => {
    const octokit = mockOctokit(async () => { throw new Error('Network error'); });
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/tags/v1.2.3');
    expect(result).toBeNull();
  });

  it('captures prerelease flag', async () => {
    const octokit = mockOctokit(async () => ({
      data: {
        name: 'v2.0.0-beta',
        body: '',
        html_url: 'https://example.com',
        published_at: '2026-04-16T00:00:00Z',
        prerelease: true,
        tag_name: 'v2.0.0-beta',
      },
    }));
    const result = await fetchReleaseForRef(octokit, 'o', 'r', 'refs/tags/v2.0.0-beta');
    expect(result?.prerelease).toBe(true);
  });
});
