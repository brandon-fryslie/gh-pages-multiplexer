import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock @actions/exec and @actions/core before importing the module under test.
vi.mock('@actions/exec', () => ({
  exec: vi.fn(),
}));
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));

import * as exec from '@actions/exec';
import { prepareBranch, commitAndPush, cleanupWorktree, readCnameFile } from '../src/branch-manager.js';
import type { DeployConfig, DeploymentContext } from '../src/types.js';

const execMock = exec.exec as unknown as ReturnType<typeof vi.fn>;

const baseConfig: DeployConfig = {
  sourceDir: 'dist',
  targetBranch: 'gh-pages',
  refPatterns: [],
  basePathMode: 'base-tag',
  basePathPrefix: '',
  token: 'ghs_token123',
  repo: 'owner/repo',
  ref: 'refs/tags/v1.0.0',
};

const ctx: DeploymentContext = {
  versionSlot: 'v1.0.0',
  originalRef: 'refs/tags/v1.0.0',
  sha: 'abc123',
  timestamp: '2026-04-06T00:00:00Z',
  basePath: '/repo/v1.0.0/',
};

beforeEach(() => {
  execMock.mockReset();
});

describe('prepareBranch', () => {
  it('fetches existing branch and creates a worktree', async () => {
    // Default: all exec calls succeed with exit 0.
    execMock.mockResolvedValue(0);

    const workdir = await prepareBranch(baseConfig);

    expect(workdir).toMatch(/gh-pages-\d+/);

    // Collect the first argument (command) of every call for sequence checks.
    const calls = execMock.mock.calls.map((c) => ({ cmd: c[0] as string, args: c[1] as string[] }));

    // git config user.name / user.email
    expect(calls.some((c) => c.args.includes('config') && c.args.includes('user.name'))).toBe(true);
    expect(calls.some((c) => c.args.includes('config') && c.args.includes('user.email'))).toBe(true);

    // git remote set-url with token in URL
    const remoteCall = calls.find((c) => c.args.includes('remote') && c.args.includes('set-url'));
    expect(remoteCall).toBeTruthy();
    expect(remoteCall!.args.join(' ')).toContain('x-access-token:ghs_token123');
    expect(remoteCall!.args.join(' ')).toContain('github.com/owner/repo.git');

    // git fetch origin gh-pages --depth=1
    expect(calls.some((c) => c.args.includes('fetch') && c.args.includes('origin') && c.args.includes('gh-pages'))).toBe(true);

    // git worktree add <workdir> origin/gh-pages
    const addCall = calls.find((c) => c.args.includes('worktree') && c.args.includes('add') && !c.args.includes('--detach'));
    expect(addCall).toBeTruthy();
    expect(addCall!.args).toContain(workdir);
    expect(addCall!.args).toContain('origin/gh-pages');
  });

  it('creates an orphan branch when fetch fails (no gh-pages)', async () => {
    // First fetch call fails; all others succeed.
    execMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('fetch')) return 1;
      return 0;
    });

    const workdir = await prepareBranch(baseConfig);

    const calls = execMock.mock.calls.map((c) => c[1] as string[]);
    // worktree add --detach <workdir>
    expect(calls.some((a) => a.includes('worktree') && a.includes('add') && a.includes('--detach'))).toBe(true);
    // checkout --orphan gh-pages (via -C workdir)
    expect(
      calls.some((a) => a.includes('-C') && a.includes(workdir) && a.includes('checkout') && a.includes('--orphan') && a.includes('gh-pages'))
    ).toBe(true);
    // rm -rf .
    expect(calls.some((a) => a.includes('-C') && a.includes(workdir) && a.includes('rm') && a.includes('-rf') && a.includes('.'))).toBe(true);
  });
});

describe('commitAndPush', () => {
  it('stages, commits, and pushes on success', async () => {
    // diff --cached --quiet returns 1 (there are changes); everything else 0.
    execMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('--cached')) return 1;
      return 0;
    });

    await commitAndPush('/tmp/wd', ctx, 'gh-pages');

    const calls = execMock.mock.calls.map((c) => c[1] as string[]);
    expect(calls.some((a) => a.includes('add') && a.includes('-A'))).toBe(true);
    const commitCall = calls.find((a) => a.includes('commit'));
    expect(commitCall).toBeTruthy();
    expect(commitCall!.join(' ')).toContain('Deploy v1.0.0');
    expect(calls.some((a) => a.includes('push') && a.includes('origin') && a.includes('HEAD:gh-pages'))).toBe(true);
  });

  it('returns early when there are no changes to commit', async () => {
    // diff --cached --quiet exits 0 => no changes.
    execMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('--cached')) return 0;
      return 0;
    });

    await commitAndPush('/tmp/wd', ctx, 'gh-pages');

    const calls = execMock.mock.calls.map((c) => c[1] as string[]);
    expect(calls.some((a) => a.includes('commit'))).toBe(false);
    expect(calls.some((a) => a.includes('push'))).toBe(false);
  });

  it('retries with fetch + rebase on push failure, then succeeds', async () => {
    let pushAttempts = 0;
    execMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('--cached')) return 1;
      if (args.includes('push')) {
        pushAttempts++;
        return pushAttempts < 2 ? 1 : 0;
      }
      return 0;
    });

    await commitAndPush('/tmp/wd', ctx, 'gh-pages', 3);

    expect(pushAttempts).toBe(2);
    const calls = execMock.mock.calls.map((c) => c[1] as string[]);
    expect(calls.some((a) => a.includes('rebase') && a.includes('origin/gh-pages'))).toBe(true);
  });

  it('throws after exhausting max retries', async () => {
    execMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff') && args.includes('--cached')) return 1;
      if (args.includes('push')) return 1;
      return 0;
    });

    await expect(commitAndPush('/tmp/wd', ctx, 'gh-pages', 3)).rejects.toThrow(/push/i);
  });
});

describe('cleanupWorktree', () => {
  it('calls git worktree remove --force', async () => {
    execMock.mockResolvedValue(0);
    await cleanupWorktree('/tmp/wd');
    const calls = execMock.mock.calls.map((c) => c[1] as string[]);
    expect(calls.some((a) => a.includes('worktree') && a.includes('remove') && a.includes('/tmp/wd') && a.includes('--force'))).toBe(true);
  });
});

describe('readCnameFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cname-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns trimmed contents when CNAME exists', async () => {
    await writeFile(path.join(dir, 'CNAME'), 'docs.example.com\n', 'utf8');
    expect(await readCnameFile(dir)).toBe('docs.example.com');
  });

  it('returns null when CNAME does not exist', async () => {
    expect(await readCnameFile(dir)).toBeNull();
  });
});
