// Real-git integration tests for publishing to the target branch: each deploy runs
// the full pipeline against a bare repository standing in for GitHub. The race
// tests hold every deploy's first push until all of them have rendered, so each
// one is guaranteed to have built on the same tip -- the exact race two CI runs hit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));
vi.mock('@actions/exec', async (importOriginal) => {
  const real = await importOriginal<typeof import('@actions/exec')>();
  return { ...real, getExecOutput: vi.fn(real.getExecOutput) };
});

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { deploy } from '../src/deploy.js';
import { renderIndexHtml, renderRedirectHtml } from '../src/index-renderer.js';
import { renderRobotsTxt } from '../src/robots-generator.js';
import { latestNonPrSlot } from '../src/sitemap-generator.js';
import type { DeployConfig, Manifest, SourceRepo } from '../src/types.js';

const run = promisify(execFile);
const getExecOutputMock = vi.mocked(exec.getExecOutput);
const realGetExecOutput = (await vi.importActual<typeof import('@actions/exec')>('@actions/exec')).getExecOutput;

const TARGET = 'gh-pages';
const META = { owner: 'owner', repo: 'repo' };

let root: string;
let remote: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** A fresh clone of the source repo, as each CI runner has its own. */
async function sourceClone(name: string): Promise<SourceRepo> {
  const dir = path.join(root, name);
  await run('git', ['clone', '--quiet', path.join(root, 'origin-src'), dir]);
  return { dir, remote: { url: remote, config: [] } };
}

async function siteDir(name: string): Promise<string> {
  const dir = path.join(root, `site-${name}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), `<html><head></head><body>${name}</body></html>`);
  return dir;
}

async function configFor(version: string): Promise<DeployConfig> {
  return {
    sourceDir: await siteDir(version),
    targetBranch: TARGET,
    refPatterns: [],
    basePathMode: 'base-tag',
    basePathPrefix: '',
    token: '',
    repo: 'owner/repo',
    ref: `refs/tags/${version}`,
    version,
    widgetIcon: '',
    widgetLabel: '',
    widgetPosition: '',
    widgetColor: '',
    prBaseRef: '',
    cleanupVersions: [],
    namespaceStorage: false,
  };
}

/** Hold the first `n` pushes until all `n` have been reached. */
function holdFirstPushes(n: number): void {
  let waiting = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((r) => (release = r));
  getExecOutputMock.mockImplementation(async (cmd, args, opts) => {
    if (args?.[0] === 'push' && waiting < n) {
      waiting++;
      if (waiting === n) release();
      await allArrived;
    }
    return realGetExecOutput(cmd, args, opts);
  });
}

async function remoteFile(rel: string): Promise<string> {
  return git(root, '--git-dir', remote, 'show', `${TARGET}:${rel}`);
}

/** Every derived file on the remote must be exactly what the final manifest renders to. */
async function expectDerivedFilesMatchManifest(): Promise<Manifest> {
  const manifest = JSON.parse(await remoteFile('versions.json')) as Manifest;
  expect(await remoteFile('index.html')).toBe(renderRedirectHtml(manifest).trim());
  expect(await remoteFile('_versions/index.html')).toBe(renderIndexHtml(manifest, META).trim());
  expect(await remoteFile('robots.txt')).toBe(renderRobotsTxt(manifest, '/repo/').trim());
  const health = JSON.parse(await remoteFile('_health.json'));
  expect(health.version_count).toBe(manifest.versions.length);
  expect(health.latest_deploy_version).toBe(manifest.versions[0].version);
  expect(await remoteFile('sitemap.xml')).toContain(`/repo/${latestNonPrSlot(manifest)}/index.html`);
  return manifest;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'concurrent-deploy-'));
  remote = path.join(root, 'remote.git');
  await run('git', ['init', '--quiet', '--bare', remote]);
  const src = path.join(root, 'origin-src');
  await run('git', ['init', '--quiet', src]);
  await writeFile(path.join(src, 'README'), 'source\n');
  await git(src, 'add', '.');
  await git(src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  process.env.GITHUB_SHA = await git(src, 'rev-parse', 'HEAD');
  getExecOutputMock.mockReset();
  getExecOutputMock.mockImplementation(realGetExecOutput);
});

afterEach(async () => {
  delete process.env.GITHUB_SHA;
  await rm(root, { recursive: true, force: true });
});

describe('concurrent deploys', () => {
  it('two deploys built on the same tip both land, and derived files match the final manifest', async () => {
    const seed = await deploy(await configFor('v0.9.0'), await sourceClone('seed'));
    expect(seed).toMatchObject({ outcome: 'pushed', attempts: 1, widget: { inserted: 1, refreshed: 0, current: 0 } });

    const [a, b] = [await sourceClone('a'), await sourceClone('b')];
    const [cfgA, cfgB] = [await configFor('v1.0.0'), await configFor('v2.0.0')];
    holdFirstPushes(2);
    const results = await Promise.all([deploy(cfgA, a), deploy(cfgB, b)]);

    // Exactly one of them lost the race and rebuilt from the winner's tip.
    expect(results.map((r) => r.attempts).sort()).toEqual([1, 2]);
    expect(results.map((r) => r.outcome)).toEqual(['pushed', 'pushed']);

    const manifest = await expectDerivedFilesMatchManifest();
    expect(manifest.versions.map((v) => v.version).sort()).toEqual(['v0.9.0', 'v1.0.0', 'v2.0.0']);
    for (const slot of ['v0.9.0', 'v1.0.0', 'v2.0.0']) {
      expect(await remoteFile(`${slot}/index.html`)).toContain(`<body>${slot}`);
    }
  });

  it('two first-ever deploys racing to create the branch both land', async () => {
    const [a, b] = [await sourceClone('a'), await sourceClone('b')];
    const [cfgA, cfgB] = [await configFor('v1.0.0'), await configFor('pr-7')];
    holdFirstPushes(2);
    const results = await Promise.all([deploy(cfgA, a), deploy(cfgB, b)]);

    expect(results.map((r) => r.attempts).sort()).toEqual([1, 2]);
    const manifest = await expectDerivedFilesMatchManifest();
    expect(manifest.versions.map((v) => v.version).sort()).toEqual(['pr-7', 'v1.0.0']);
  });

  it('a burst of simultaneous deploys all land, each within as many attempts as there are deploys', async () => {
    const slots = ['v1.0.0', 'v2.0.0', 'v3.0.0', 'v4.0.0', 'v5.0.0', 'v6.0.0', 'v7.0.0'];
    const runs = await Promise.all(slots.map(async (s) => [await configFor(s), await sourceClone(s)] as const));
    holdFirstPushes(slots.length);
    const results = await Promise.all(runs.map(([config, source]) => deploy(config, source)));

    // Every loss is another deploy's win, so none of N simultaneous deploys needs more than N attempts.
    for (const r of results) expect(r.attempts).toBeLessThanOrEqual(slots.length);
    const manifest = await expectDerivedFilesMatchManifest();
    expect(manifest.versions.map((v) => v.version).sort()).toEqual(slots);
  }, 30_000);

  it('keeps rebuilding for as long as other deploys keep moving the tip', async () => {
    await deploy(await configFor('v0.9.0'), await sourceClone('seed'));
    const config = await configFor('v1.0.0');
    const source = await sourceClone('a');
    // Another deploy publishes just before each of this one's first 8 pushes: more races than any
    // fixed attempt count would have allowed.
    const races = 8;
    let pushes = 0;
    getExecOutputMock.mockImplementation(async (cmd, args, opts) => {
      if (args?.[0] === 'push' && pushes++ < races) {
        const tip = await git(root, '--git-dir', remote, 'rev-parse', TARGET);
        const moved = await git(root, '--git-dir', remote, 'commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'other deploy');
        await git(root, '--git-dir', remote, 'update-ref', `refs/heads/${TARGET}`, moved);
      }
      return realGetExecOutput(cmd, args, opts);
    });

    expect(await deploy(config, source)).toMatchObject({ outcome: 'pushed', attempts: races + 1 });
    const tip = await git(root, '--git-dir', remote, 'rev-parse', `${TARGET}^`);
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(`Publish attempt ${races + 1} on ${tip}: pushed`);
    const manifest = await expectDerivedFilesMatchManifest();
    expect(manifest.versions.map((v) => v.version).sort()).toEqual(['v0.9.0', 'v1.0.0']);
  }, 30_000);

  it('fails loudly when the push fails for any reason other than a moved tip', async () => {
    const config = await configFor('v1.0.0');
    // A pre-receive hook that declines everything: a rejection that retrying cannot fix.
    const hook = path.join(remote, 'hooks', 'pre-receive');
    await writeFile(hook, '#!/bin/sh\necho "policy says no" >&2\nexit 1\n', { mode: 0o755 });
    await git(remote, 'config', 'core.hooksPath', path.join(remote, 'hooks')); // beat any global hooksPath

    const source = await sourceClone('a');
    await expect(deploy(config, source)).rejects.toThrow(/git push .* failed[\s\S]*policy says no/);
    const pushes = getExecOutputMock.mock.calls.filter(([, args]) => args?.[0] === 'push');
    expect(pushes).toHaveLength(1);
    // The failed attempt's worktree is removed, not left registered in the source repo.
    expect((await git(source.dir, 'worktree', 'list')).split('\n')).toHaveLength(1);
  });

  it('fails loudly instead of treating an unreachable remote as a first deploy', async () => {
    const config = await configFor('v1.0.0');
    const source = { ...(await sourceClone('a')), remote: { url: path.join(root, 'no-such-remote.git'), config: [] } };

    await expect(deploy(config, source)).rejects.toThrow(/git ls-remote .* failed/);
  });

  it('fails on the next attempt when a stale rejection left the tip where it was, naming the tip and the rejection', async () => {
    await deploy(await configFor('v0.9.0'), await sourceClone('seed'));
    const tip = await git(root, '--git-dir', remote, 'rev-parse', TARGET);
    const config = await configFor('v1.0.0');
    const source = await sourceClone('a');
    // The remote reports a lost race, but nothing published: e.g. a pushInsteadOf rewrite sends the
    // push somewhere other than where ls-remote looks.
    const rejection = `!\tdeadbeef:refs/heads/${TARGET}\t[rejected] (non-fast-forward)`;
    let pushes = 0;
    getExecOutputMock.mockImplementation(async (cmd, args, opts) => {
      if (args?.[0] !== 'push') return realGetExecOutput(cmd, args, opts);
      pushes++;
      return { exitCode: 1, stdout: `To remote\n${rejection}\nDone\n`, stderr: '' };
    });

    await expect(deploy(config, source)).rejects.toThrow(
      `attempt 1 was rejected as stale (${rejection}) but the remote tip is still ${tip}, the commit it was built on`,
    );
    expect(pushes).toBe(1);
  });

  it('first deploy creates the branch on the remote without touching local branches or look-alike refs', async () => {
    // A remote branch whose name merely ends in the target must not read as "the target exists".
    const seeder = await sourceClone('seeder');
    await git(seeder.dir, 'push', '--quiet', remote, `HEAD:refs/heads/docs/${TARGET}`);
    // A local branch named like the target, as a CLI user's own clone may have.
    const source = await sourceClone('a');
    await git(source.dir, 'branch', TARGET);
    const localBefore = await git(source.dir, 'for-each-ref', 'refs/heads');

    const result = await deploy(await configFor('v1.0.0'), source);

    expect(result).toMatchObject({ outcome: 'pushed', attempts: 1 });
    // The deploy commit is a root commit: gh-pages history never includes source history.
    expect(await git(root, '--git-dir', remote, 'rev-list', '--count', TARGET)).toBe('1');
    expect(await git(source.dir, 'for-each-ref', 'refs/heads')).toBe(localBefore);
    await expectDerivedFilesMatchManifest();
  });

  it('deploying any slot refreshes the widget an earlier deploy left in every other slot', async () => {
    await deploy(await configFor('v0.9.0'), await sourceClone('seed'));
    // Stand in for a slot deployed by an older release of this action: same marker, older script.
    const editor = path.join(root, 'editor');
    await run('git', ['clone', '--quiet', '--branch', TARGET, remote, editor]);
    const page = path.join(editor, 'v0.9.0', 'index.html');
    const widgetBlock = /<script><!-- gh-pages-multiplexer:nav-widget -->[\s\S]*?<\/script>/;
    const current = await readFile(page, 'utf8');
    const stale = current.replace(widgetBlock, '<script><!-- gh-pages-multiplexer:nav-widget -->var OLD;</script>');
    expect(stale).not.toBe(current);
    await writeFile(page, stale);
    await git(editor, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-am', 'old widget');
    await git(editor, 'push', '--quiet', 'origin', TARGET);

    const result = await deploy(await configFor('v1.0.0'), await sourceClone('a'));

    expect(result.widget).toEqual({ inserted: 1, refreshed: 1, current: 0 });
    expect((await remoteFile('v0.9.0/index.html')).match(widgetBlock)?.[0]).toBe(current.match(widgetBlock)?.[0]);
  });

  it('deploying a slot that is also being cleaned up publishes it as a manifest entry', async () => {
    for (const slot of ['v0.9.0', 'pr-5', 'pr-6']) await deploy(await configFor(slot), await sourceClone(slot));

    // A run for PR 5 that starts after PR 5 closed: its own slot is in the cleanup set.
    const config = { ...(await configFor('pr-5')), cleanupVersions: ['pr-5', 'pr-6'] };
    const result = await deploy(config, await sourceClone('late'));

    const manifest = await expectDerivedFilesMatchManifest();
    expect(manifest.versions.map((v) => v.version)).toEqual(['pr-5', 'v0.9.0']);
    const slotDirs = (await git(root, '--git-dir', remote, 'ls-tree', '-d', '--name-only', TARGET))
      .split('\n')
      .filter((dir) => dir !== '_versions');
    expect(slotDirs.sort()).toEqual(['pr-5', 'v0.9.0']);
    expect(result.widget).toEqual({ inserted: 1, refreshed: 0, current: 1 });
  });

  it('redeploying identical content is a successful no-op', async () => {
    const config = await configFor('v1.0.0');
    // Pin the clock: the manifest entry and health record carry the deploy timestamp.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      await deploy(config, await sourceClone('a'));
      // A same-sha redeploy records an empty commit delta, so the second deploy still changes
      // versions.json; from then on the rendered tree is identical.
      await deploy(config, await sourceClone('b'));
      const tip = await git(root, '--git-dir', remote, 'rev-parse', TARGET);

      const result = await deploy(config, await sourceClone('c'));
      expect(result).toMatchObject({ outcome: 'unchanged', attempts: 1 });
      expect(await git(root, '--git-dir', remote, 'rev-parse', TARGET)).toBe(tip);
    } finally {
      vi.useRealTimers();
    }
  });
});
