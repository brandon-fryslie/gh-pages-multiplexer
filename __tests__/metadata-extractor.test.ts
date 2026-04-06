import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractCommits } from '../src/metadata-extractor.js';
import type { CommitInfo } from '../src/types.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ghpm-meta-'));
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

async function head(dir: string): Promise<string> {
  return git(dir, 'rev-parse', 'HEAD');
}

describe('extractCommits', () => {
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

  it('Test 1: first deploy returns all commits newest-first with full fields', async () => {
    const dir = await track(makeRepo());
    await commitFile(dir, '1', 'first');
    await commitFile(dir, '2', 'second');
    // third has a body with a newline
    await writeFile(path.join(dir, 'file.txt'), '3');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', 'feat: thing', '-m', 'Body line 1\nBody line 2');
    const sha = await head(dir);

    const out = await extractCommits(dir, sha, null);
    expect(out).toHaveLength(3);
    expect(out[0].sha).toHaveLength(40);
    expect(out[0].author_name).toBe('Alice Example');
    expect(out[0].author_email).toBe('alice@example.com');
    expect(out[0].message).toContain('feat: thing');
    expect(out[0].message).toContain('Body line 1');
    expect(out[0].message).toContain('Body line 2');
    expect(out[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out[1].message).toContain('second');
    expect(out[2].message).toContain('first');
  });

  it('Test 2: incremental range returns only commits in range', async () => {
    const dir = await track(makeRepo());
    await commitFile(dir, '1', 'c1');
    const prev = await commitFile(dir, '2', 'c2');
    await commitFile(dir, '3', 'c3');
    const cur = await commitFile(dir, '4', 'c4');

    const out = await extractCommits(dir, cur, prev);
    expect(out).toHaveLength(2);
    expect(out[0].message).toContain('c4');
    expect(out[1].message).toContain('c3');
  });

  it('Test 3: first deploy caps at 100', async () => {
    const dir = await track(makeRepo());
    for (let i = 0; i < 150; i++) {
      await commitFile(dir, String(i), `c${i}`);
    }
    const cur = await head(dir);
    const out = await extractCommits(dir, cur, null);
    expect(out).toHaveLength(100);
  });

  it('Test 4: incremental range caps at 100', async () => {
    const dir = await track(makeRepo());
    const prev = await commitFile(dir, 'base', 'base');
    for (let i = 0; i < 150; i++) {
      await commitFile(dir, String(i), `c${i}`);
    }
    const cur = await head(dir);
    const out = await extractCommits(dir, cur, prev);
    expect(out).toHaveLength(100);
  });

  it('Test 5: unreachable previousSha falls back to first-deploy', async () => {
    const dir = await track(makeRepo());
    await commitFile(dir, '1', 'c1');
    await commitFile(dir, '2', 'c2');
    const cur = await commitFile(dir, '3', 'c3');

    const fakeSha = 'deadbeef'.repeat(5); // 40 hex chars, not in repo
    const out = await extractCommits(dir, cur, fakeSha);
    const baseline = await extractCommits(dir, cur, null);
    expect(out).toEqual(baseline);
    expect(out).toHaveLength(3);
  });

  it('Test 6: shallow clone missing history fails loudly with fetch-depth hint', async () => {
    const src = await track(makeRepo());
    for (let i = 0; i < 5; i++) {
      await commitFile(src, String(i), `c${i}`);
    }
    const oldSha = await git(src, 'rev-parse', 'HEAD~4'); // reachable only with full history
    const curSha = await head(src);

    const dstParent = await mkdtemp(path.join(tmpdir(), 'ghpm-meta-dst-'));
    dirs.push(dstParent);
    const dst = path.join(dstParent, 'shallow');
    await exec('git', ['clone', '--depth=1', `file://${src}`, dst]);

    await expect(extractCommits(dst, curSha, oldSha)).rejects.toThrow(/fetch-depth: 0/);
  });

  it('Test 7: multiline commit message round-trips intact', async () => {
    const dir = await track(makeRepo());
    await writeFile(path.join(dir, 'file.txt'), 'x');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', 'feat: thing', '-m', 'Body line 1\nBody line 2');
    const cur = await head(dir);
    const out = await extractCommits(dir, cur, null);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('feat: thing');
    expect(out[0].message).toContain('Body line 1\nBody line 2');
  });
});
