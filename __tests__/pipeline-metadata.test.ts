// End-to-end proof: the real readManifest -> extractCommits -> updateManifest ->
// writeManifest chain delivers correct per-deploy commit histories to the
// manifest across first-deploy, incremental, schema-1 legacy, and multi-slot cases.
// No mocks — builds real git fixture repos.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));

import { extractCommits } from '../src/metadata-extractor.js';
import { readManifest, updateManifest, writeManifest } from '../src/manifest-manager.js';
import { writeIndexHtml } from '../src/branch-manager.js';
import type { Manifest, ManifestEntry } from '../src/types.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ghpm-pipe-repo-'));
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'alice@example.com');
  await git(dir, 'config', 'user.name', 'Alice Example');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

async function commitFile(dir: string, content: string, msg: string): Promise<string> {
  await writeFile(path.join(dir, 'file.txt'), content);
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

async function makeWorkdir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'ghpm-pipe-wd-'));
}

/** Run the real pipeline Stage 3 sequence and return the updated manifest on disk. */
async function runStage3(
  workdir: string,
  sourceRepo: string,
  slot: string,
  headSha: string,
  originalRef = 'refs/heads/main',
): Promise<Manifest> {
  const manifest = await readManifest(workdir);
  const previousSha = manifest.versions.find((v) => v.version === slot)?.sha ?? null;
  const commits = await extractCommits(sourceRepo, headSha, previousSha);
  const entry: ManifestEntry = {
    version: slot,
    ref: originalRef,
    sha: headSha,
    timestamp: new Date().toISOString(),
    commits,
  };
  const updated = updateManifest(manifest, entry);
  await writeManifest(workdir, updated);
  return JSON.parse(await readFile(path.join(workdir, 'versions.json'), 'utf8')) as Manifest;
}

describe('pipeline metadata end-to-end', () => {
  const dirs: string[] = [];
  const track = async (p: Promise<string>): Promise<string> => {
    const d = await p;
    dirs.push(d);
    return d;
  };
  afterAll(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('E2E-1: first deploy populates commits from full history', async () => {
    const repo = await track(makeRepo());
    const workdir = await track(makeWorkdir());
    const s1 = await commitFile(repo, '1', 'first');
    const s2 = await commitFile(repo, '2', 'second');
    const s3 = await commitFile(repo, '3', 'third');

    const manifest = await runStage3(workdir, repo, 'v1', s3);

    expect(manifest.schema).toBe(2);
    expect(manifest.versions).toHaveLength(1);
    expect(manifest.versions[0].version).toBe('v1');
    expect(manifest.versions[0].commits).toHaveLength(3);
    // newest first
    expect(manifest.versions[0].commits?.map((c) => c.sha)).toEqual([s3, s2, s1]);
  });

  it('E2E-2: second deploy records only commits since previous deploy', async () => {
    const repo = await track(makeRepo());
    const workdir = await track(makeWorkdir());
    await commitFile(repo, '1', 'first');
    await commitFile(repo, '2', 'second');
    const firstHead = await commitFile(repo, '3', 'third');
    await runStage3(workdir, repo, 'v1', firstHead);

    const s4 = await commitFile(repo, '4', 'fourth');
    const s5 = await commitFile(repo, '5', 'fifth');
    const manifest = await runStage3(workdir, repo, 'v1', s5);

    expect(manifest.versions).toHaveLength(1);
    expect(manifest.versions[0].sha).toBe(s5);
    expect(manifest.versions[0].commits).toHaveLength(2);
    expect(manifest.versions[0].commits?.map((c) => c.sha)).toEqual([s5, s4]);
  });

  it('E2E-3: legacy schema 1 on disk reads, then rewrites as schema 2 preserving old entry', async () => {
    const repo = await track(makeRepo());
    const workdir = await track(makeWorkdir());
    const s1 = await commitFile(repo, '1', 'first');

    // Legacy schema-1 manifest on disk with an entry lacking commits.
    const legacy: Manifest = {
      schema: 1,
      versions: [
        {
          version: 'v0',
          ref: 'refs/tags/v0',
          sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
    };
    await writeFile(path.join(workdir, 'versions.json'), JSON.stringify(legacy));

    const read = await readManifest(workdir);
    expect(read.schema).toBe(1);
    expect(read.versions).toHaveLength(1);
    expect(read.versions[0].commits).toBeUndefined();

    const manifest = await runStage3(workdir, repo, 'v1', s1);

    expect(manifest.schema).toBe(2);
    expect(manifest.versions).toHaveLength(2);
    // newest first — new v1 prepended, legacy v0 preserved.
    expect(manifest.versions[0].version).toBe('v1');
    expect(manifest.versions[0].commits).toHaveLength(1);
    expect(manifest.versions[1].version).toBe('v0');
    expect(manifest.versions[1].commits).toBeUndefined();
  });

  // ---- index.html-in-deploy-commit assertions (Plan 03-03) ----
  // These use a git-backed workdir so we can assert index.html and versions.json
  // land in the SAME commit via `git log -1 --name-only`.

  async function makeGitWorkdir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'ghpm-pipe-ghp-'));
    await git(dir, 'init', '-q', '-b', 'gh-pages');
    await git(dir, 'config', 'user.email', 'bot@example.com');
    await git(dir, 'config', 'user.name', 'Bot');
    await git(dir, 'config', 'commit.gpgsign', 'false');
    return dir;
  }

  async function runDeployStage(
    workdir: string,
    sourceRepo: string,
    slot: string,
    headSha: string,
  ): Promise<void> {
    const manifest = await readManifest(workdir);
    const previousSha = manifest.versions.find((v) => v.version === slot)?.sha ?? null;
    const commits = await extractCommits(sourceRepo, headSha, previousSha);
    const entry: ManifestEntry = {
      version: slot,
      ref: `refs/tags/${slot}`,
      sha: headSha,
      timestamp: new Date().toISOString(),
      commits,
    };
    const updated = updateManifest(manifest, entry);
    await writeManifest(workdir, updated);
    await writeIndexHtml(workdir, updated, { owner: 'acme', repo: 'widgets' });
    await git(workdir, 'add', '-A');
    await git(workdir, 'commit', '-q', '-m', `Deploy ${slot}`);
  }

  describe('index.html in deploy commit', () => {
    it('INDX-01: index.html and versions.json land in the same commit', async () => {
      const repo = await track(makeRepo());
      const workdir = await track(makeGitWorkdir());
      const sha = await commitFile(repo, 'x', 'init');
      await runDeployStage(workdir, repo, 'v1.2.3', sha);

      const nameOnly = await git(workdir, 'log', '-1', '--name-only', '--pretty=format:');
      const files = new Set(nameOnly.split('\n').map((s) => s.trim()).filter(Boolean));
      expect(files.has('versions.json')).toBe(true);
      expect(files.has('index.html')).toBe(true);
    });

    it('INDX-01: HEAD:index.html is well-formed HTML containing the deployed version slug', async () => {
      const repo = await track(makeRepo());
      const workdir = await track(makeGitWorkdir());
      const sha = await commitFile(repo, 'x', 'init');
      await runDeployStage(workdir, repo, 'v1.2.3', sha);

      const content = await git(workdir, 'show', 'HEAD:index.html');
      expect(content.length).toBeGreaterThan(0);
      expect(content.toLowerCase().startsWith('<!doctype html')).toBe(true);
      expect(content).toContain('v1.2.3');
    });

    it('INDX-06: redeploy with a new version overwrites index.html with fresh content', async () => {
      const repo = await track(makeRepo());
      const workdir = await track(makeGitWorkdir());
      const s1 = await commitFile(repo, '1', 'first');
      await runDeployStage(workdir, repo, 'v1.0.0', s1);
      const first = await git(workdir, 'show', 'HEAD:index.html');

      const s2 = await commitFile(repo, '2', 'second');
      await runDeployStage(workdir, repo, 'v2.0.0', s2);
      const second = await git(workdir, 'show', 'HEAD:index.html');

      expect(second).not.toBe(first);
      expect(second).toContain('v2.0.0');
      expect(first).not.toContain('v2.0.0');
    });

    it('INDX-01: first-ever deploy on fresh branch produces index.html alongside versions.json', async () => {
      const repo = await track(makeRepo());
      const workdir = await track(makeGitWorkdir());
      // No prior commits on gh-pages branch — this is the first-ever deploy.
      const sha = await commitFile(repo, 'x', 'init');
      await runDeployStage(workdir, repo, 'v0.1.0', sha);

      const nameOnly = await git(workdir, 'log', '-1', '--name-only', '--pretty=format:');
      const files = new Set(nameOnly.split('\n').map((s) => s.trim()).filter(Boolean));
      expect(files.has('versions.json')).toBe(true);
      expect(files.has('index.html')).toBe(true);
      const content = await git(workdir, 'show', 'HEAD:index.html');
      expect(content).toContain('v0.1.0');
    });
  });

  it('E2E-4: different version slots isolate their commit histories', async () => {
    const repo = await track(makeRepo());
    const workdir = await track(makeWorkdir());
    const a = await commitFile(repo, 'A', 'A');
    const b = await commitFile(repo, 'B', 'B');
    const c = await commitFile(repo, 'C', 'C');

    // Deploy v1 from HEAD=C.
    const m1 = await runStage3(workdir, repo, 'v1', c);
    expect(m1.versions.find((v) => v.version === 'v1')?.commits).toHaveLength(3);

    // Deploy v2 from the same HEAD=C. v2 has no prior entry, so previousSha is null
    // and extractCommits must return the full history (A-B-C), NOT the empty
    // incremental range from v1's previous SHA.
    const m2 = await runStage3(workdir, repo, 'v2', c);
    const v2 = m2.versions.find((v) => v.version === 'v2');
    expect(v2?.commits).toHaveLength(3);
    expect(v2?.commits?.map((x) => x.sha)).toEqual([c, b, a]);
    // v1 preserved untouched.
    expect(m2.versions.find((v) => v.version === 'v1')?.commits).toHaveLength(3);
  });
});
