import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/deploy.js', () => ({
  deploy: vi.fn(),
}));

import { main } from '../src/cli.js';
import { deploy } from '../src/deploy.js';

let stderrChunks: string[] = [];
let stdoutChunks: string[] = [];

beforeEach(() => {
  stderrChunks = [];
  stdoutChunks = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.mocked(deploy).mockReset();
  vi.mocked(deploy).mockResolvedValue({ version: 'v1.0.0', url: 'https://owner.github.io/name/v1.0.0/' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FULL_ARGV = [
  'deploy',
  '--source-dir=dist',
  '--target-branch=gh-pages',
  '--ref-patterns=v*,main',
  '--base-path-mode=base-tag',
  '--base-path-prefix=',
  '--repo=owner/name',
  '--ref=refs/tags/v1.0.0',
];

const stderr = () => stderrChunks.join('');
const stdout = () => stdoutChunks.join('');

describe('cli main()', () => {
  it('happy path — all flags → exit 0 and deploy called with parsed config', async () => {
    const code = await main(FULL_ARGV, { GITHUB_TOKEN: 'ghs_xxx' });
    expect(code).toBe(0);
    expect(deploy).toHaveBeenCalledTimes(1);
    const [cfg] = vi.mocked(deploy).mock.calls[0];
    expect(cfg).toMatchObject({
      sourceDir: 'dist',
      targetBranch: 'gh-pages',
      refPatterns: ['v*', 'main'],
      basePathMode: 'base-tag',
      basePathPrefix: '',
      token: 'ghs_xxx',
      repo: 'owner/name',
      ref: 'refs/tags/v1.0.0',
    });
  });

  it('token from GH_TOKEN fallback', async () => {
    const code = await main(FULL_ARGV, { GH_TOKEN: 'ghs_yyy' });
    expect(code).toBe(0);
    expect(vi.mocked(deploy).mock.calls[0][0].token).toBe('ghs_yyy');
  });

  it('GITHUB_TOKEN preferred over GH_TOKEN', async () => {
    const code = await main(FULL_ARGV, { GITHUB_TOKEN: 'pref', GH_TOKEN: 'fall' });
    expect(code).toBe(0);
    expect(vi.mocked(deploy).mock.calls[0][0].token).toBe('pref');
  });

  it('missing token → exit 2, mentions both env vars', async () => {
    const code = await main(FULL_ARGV, {});
    expect(code).toBe(2);
    expect(stderr()).toContain('GITHUB_TOKEN');
    expect(stderr()).toContain('GH_TOKEN');
    expect(deploy).not.toHaveBeenCalled();
  });

  it('missing --source-dir → exit 2, mentions source-dir', async () => {
    const code = await main(
      ['deploy', '--target-branch=gh-pages', '--repo=o/n', '--ref=refs/heads/main'],
      { GITHUB_TOKEN: 'x' },
    );
    expect(code).toBe(2);
    expect(stderr().toLowerCase()).toContain('source-dir');
    expect(deploy).not.toHaveBeenCalled();
  });

  it('unknown flag → exit 2', async () => {
    const code = await main(
      ['deploy', '--source-dir=dist', '--bogus=1', '--repo=o/n', '--ref=refs/heads/main'],
      { GITHUB_TOKEN: 'x' },
    );
    expect(code).toBe(2);
    expect(stderr().toLowerCase()).toContain('bogus');
  });

  it('--help → exit 0 with usage text', async () => {
    const code = await main(['--help'], {});
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain('Usage');
    expect(out).toContain('gh-pages-multiplexer');
    expect(out).toContain('deploy');
    for (const flag of ['source-dir', 'target-branch', 'ref-patterns', 'base-path-mode', 'base-path-prefix', 'repo', 'ref']) {
      expect(out).toContain(flag);
    }
    expect(deploy).not.toHaveBeenCalled();
  });

  it('--version → exit 0 with version string', async () => {
    const code = await main(['--version'], {});
    expect(code).toBe(0);
    expect(stdout()).toMatch(/\d+\.\d+\.\d+/);
    expect(deploy).not.toHaveBeenCalled();
  });

  it('deploy throws → exit 1, message in stderr, no stack by default', async () => {
    vi.mocked(deploy).mockRejectedValue(new Error('push failed: non-fast-forward'));
    const code = await main(FULL_ARGV, { GITHUB_TOKEN: 'x' });
    expect(code).toBe(1);
    expect(stderr()).toContain('push failed: non-fast-forward');
    expect(stderr()).not.toContain('\n    at ');
  });

  it('deploy throws + DEBUG=1 → stack visible', async () => {
    vi.mocked(deploy).mockRejectedValue(new Error('push failed'));
    const code = await main(FULL_ARGV, { GITHUB_TOKEN: 'x', DEBUG: '1' });
    expect(code).toBe(1);
    expect(stderr()).toContain('push failed');
    expect(stderr()).toContain('at ');
  });

  it('deploy throws + --debug flag → stack visible', async () => {
    vi.mocked(deploy).mockRejectedValue(new Error('push failed'));
    const code = await main([...FULL_ARGV, '--debug'], { GITHUB_TOKEN: 'x' });
    expect(code).toBe(1);
    expect(stderr()).toContain('at ');
  });

  it('default ref-patterns when omitted → deploy called (empty list default)', async () => {
    const code = await main(
      ['deploy', '--source-dir=dist', '--target-branch=gh-pages', '--repo=o/n', '--ref=refs/heads/main'],
      { GITHUB_TOKEN: 'x' },
    );
    expect(code).toBe(0);
    const cfg = vi.mocked(deploy).mock.calls[0][0];
    expect(Array.isArray(cfg.refPatterns)).toBe(true);
  });

  it('missing deploy subcommand → exit 2 mentioning deploy', async () => {
    const code = await main(['list'], { GITHUB_TOKEN: 'x' });
    expect(code).toBe(2);
    expect(stderr()).toContain('deploy');
    expect(deploy).not.toHaveBeenCalled();
  });

  it('--token flag is NOT supported → exit 2, stderr mentions env vars', async () => {
    const code = await main(
      ['deploy', '--source-dir=dist', '--token=ghs_zzz', '--repo=o/n', '--ref=refs/heads/main'],
      {},
    );
    expect(code).toBe(2);
    // either unknown-flag error or missing-token error; either way stderr mentions env vars or token
    expect(stderr().toLowerCase()).toMatch(/token|env/);
  });
});
