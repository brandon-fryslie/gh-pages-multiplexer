// [LAW:behavior-not-structure] Tests assert cleanup behavior (which versions are identified
//   as stale), not implementation details (how the API is called).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import type { Manifest } from '../src/types.js';
import {
  extractPrEntries,
  findClosedPrVersions,
  fetchRemoteManifest,
  resolveCleanupVersions,
  type CleanupOctokit,
} from '../src/pr-cleanup.js';

describe('extractPrEntries', () => {
  it('extracts pr-N entries with parsed PR numbers', () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [
        { version: 'pr-42', ref: 'refs/pull/42/merge', sha: 'a', timestamp: 't' },
        { version: 'v1.0.0', ref: 'refs/tags/v1.0.0', sha: 'b', timestamp: 't' },
        { version: 'pr-7', ref: 'refs/pull/7/merge', sha: 'c', timestamp: 't' },
        { version: 'main', ref: 'refs/heads/main', sha: 'd', timestamp: 't' },
      ],
    };
    expect(extractPrEntries(manifest)).toEqual([
      { version: 'pr-42', prNumber: 42 },
      { version: 'pr-7', prNumber: 7 },
    ]);
  });

  it('returns empty array when no PR versions exist', () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [
        { version: 'v1.0.0', ref: 'refs/tags/v1.0.0', sha: 'a', timestamp: 't' },
      ],
    };
    expect(extractPrEntries(manifest)).toEqual([]);
  });

  it('returns empty array for empty manifest', () => {
    expect(extractPrEntries({ schema: 2, versions: [] })).toEqual([]);
  });
});

describe('findClosedPrVersions', () => {
  function mockOctokit(statuses: Record<number, string>): CleanupOctokit {
    return {
      rest: {
        repos: {
          getContent: vi.fn(),
        },
        pulls: {
          get: vi.fn(async ({ pull_number }: { pull_number: number }) => {
            if (pull_number in statuses) {
              return { data: { state: statuses[pull_number] } };
            }
            throw new Error(`PR #${pull_number} not found`);
          }),
        },
      },
    };
  }

  it('returns version slots for closed PRs', async () => {
    const octokit = mockOctokit({ 42: 'closed', 7: 'open', 13: 'closed' });
    const result = await findClosedPrVersions(octokit, 'owner', 'repo', [
      { version: 'pr-42', prNumber: 42 },
      { version: 'pr-7', prNumber: 7 },
      { version: 'pr-13', prNumber: 13 },
    ]);
    expect(result).toEqual(['pr-42', 'pr-13']);
  });

  it('includes merged PRs (state is not open)', async () => {
    const octokit = mockOctokit({ 10: 'merged' });
    const result = await findClosedPrVersions(octokit, 'owner', 'repo', [
      { version: 'pr-10', prNumber: 10 },
    ]);
    // GitHub API returns state 'closed' for merged PRs, but we check !== 'open'
    // so any non-open state is treated as stale.
    expect(result).toEqual(['pr-10']);
  });

  it('returns empty array when all PRs are open', async () => {
    const octokit = mockOctokit({ 1: 'open', 2: 'open' });
    const result = await findClosedPrVersions(octokit, 'owner', 'repo', [
      { version: 'pr-1', prNumber: 1 },
      { version: 'pr-2', prNumber: 2 },
    ]);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', async () => {
    const octokit = mockOctokit({});
    const result = await findClosedPrVersions(octokit, 'owner', 'repo', []);
    expect(result).toEqual([]);
  });

  it('skips PRs that fail API check and returns confirmed closed ones', async () => {
    const octokit = mockOctokit({ 42: 'closed' }); // PR 99 will throw
    const result = await findClosedPrVersions(octokit, 'owner', 'repo', [
      { version: 'pr-42', prNumber: 42 },
      { version: 'pr-99', prNumber: 99 },
    ]);
    expect(result).toEqual(['pr-42']);
  });
});

describe('fetchRemoteManifest', () => {
  it('returns parsed manifest from base64 content', async () => {
    const manifest: Manifest = { schema: 2, versions: [{ version: 'pr-1', ref: 'r', sha: 's', timestamp: 't' }] };
    const encoded = Buffer.from(JSON.stringify(manifest)).toString('base64');
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => ({ data: { content: encoded, encoding: 'base64' } })),
        },
        pulls: { get: vi.fn() },
      },
    };
    const result = await fetchRemoteManifest(octokit, 'o', 'r', 'gh-pages');
    expect(result).toEqual(manifest);
  });

  it('returns null when file does not exist (404)', async () => {
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => { throw new Error('Not Found'); }),
        },
        pulls: { get: vi.fn() },
      },
    };
    expect(await fetchRemoteManifest(octokit, 'o', 'r', 'gh-pages')).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const encoded = Buffer.from('not json').toString('base64');
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => ({ data: { content: encoded, encoding: 'base64' } })),
        },
        pulls: { get: vi.fn() },
      },
    };
    expect(await fetchRemoteManifest(octokit, 'o', 'r', 'gh-pages')).toBeNull();
  });
});

describe('resolveCleanupVersions', () => {
  it('returns closed PR versions from remote manifest', async () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [
        { version: 'pr-42', ref: 'refs/pull/42/merge', sha: 'a', timestamp: 't' },
        { version: 'pr-7', ref: 'refs/pull/7/merge', sha: 'b', timestamp: 't' },
        { version: 'v1.0.0', ref: 'refs/tags/v1.0.0', sha: 'c', timestamp: 't' },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(manifest)).toString('base64');
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => ({ data: { content: encoded, encoding: 'base64' } })),
        },
        pulls: {
          get: vi.fn(async ({ pull_number }: { pull_number: number }) => ({
            data: { state: pull_number === 42 ? 'closed' : 'open' },
          })),
        },
      },
    };

    const result = await resolveCleanupVersions(octokit, 'owner', 'repo', 'gh-pages');
    expect(result).toEqual(['pr-42']);
  });

  it('returns empty array when manifest fetch fails', async () => {
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => { throw new Error('Network error'); }),
        },
        pulls: { get: vi.fn() },
      },
    };
    expect(await resolveCleanupVersions(octokit, 'o', 'r', 'gh-pages')).toEqual([]);
  });

  it('returns empty array when no PR versions in manifest', async () => {
    const manifest: Manifest = {
      schema: 2,
      versions: [{ version: 'v1.0.0', ref: 'refs/tags/v1.0.0', sha: 'a', timestamp: 't' }],
    };
    const encoded = Buffer.from(JSON.stringify(manifest)).toString('base64');
    const octokit: CleanupOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => ({ data: { content: encoded, encoding: 'base64' } })),
        },
        pulls: { get: vi.fn() },
      },
    };

    const result = await resolveCleanupVersions(octokit, 'o', 'r', 'gh-pages');
    expect(result).toEqual([]);
    // Pulls.get should never have been called
    expect(octokit.rest.pulls.get).not.toHaveBeenCalled();
  });
});
