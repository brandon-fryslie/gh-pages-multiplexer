// The CLI deploys from the user's own clone, outside GitHub Actions: nothing masks its output and
// the repo's config is the user's. A real deploy through main() must print no token and leave
// .git/config byte-identical. The authenticated GitHub URL is routed to a local bare repository by
// a url.<base>.insteadOf passed in the environment, so the remote URL the CLI builds is used as-is.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';

const run = promisify(execFile);
const TOKEN = 'ghs_clideploytoken0123456789';

let root: string;
let remote: string;
let clone: string;
let output: string[];

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cli-deploy-'));
  remote = path.join(root, 'remote.git');
  await run('git', ['init', '--quiet', '--bare', remote]);
  const src = path.join(root, 'src');
  await run('git', ['init', '--quiet', src]);
  await writeFile(path.join(src, 'README'), 'source\n');
  await git(src, 'add', '.');
  await git(src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  clone = path.join(root, 'clone');
  await run('git', ['clone', '--quiet', src, clone]);
  await git(clone, 'config', 'user.name', 'Repo Owner');
  await git(clone, 'config', 'user.email', 'owner@example.com');
  process.env.GITHUB_SHA = await git(clone, 'rev-parse', 'HEAD');
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${remote}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = `https://x-access-token:${TOKEN}@github.com/owner/repo.git`;

  vi.spyOn(process, 'cwd').mockReturnValue(clone);
  output = [];
  const capture = (chunk: unknown): boolean => (output.push(String(chunk)), true);
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of ['GITHUB_SHA', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[key];
  await rm(root, { recursive: true, force: true });
});

describe('cli deploy against a real remote', () => {
  it('publishes without printing the token or touching the clone\'s config', async () => {
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>v1</body></html>');
    const configBefore = await readFile(path.join(clone, '.git', 'config'));

    const argv = ['deploy', `--source-dir=${site}`, '--repo=owner/repo', '--ref=refs/tags/v1.0.0'];
    // Twice: the second deploy takes the existing-branch path (ls-remote hit, fetch, non-root commit).
    expect(await main(argv, { GITHUB_TOKEN: TOKEN })).toBe(0);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>v1 again</body></html>');
    expect(await main(argv, { GITHUB_TOKEN: TOKEN })).toBe(0);

    expect(output.join('')).toContain('Deployed v1.0.0');
    expect(output.filter((line) => line.includes(TOKEN))).toEqual([]);
    expect(await readFile(path.join(clone, '.git', 'config'))).toEqual(configBefore);
    const log = await git(root, '--git-dir', remote, 'log', '--format=%an <%ae>', 'gh-pages');
    expect(log.split('\n')).toEqual([
      'github-actions[bot] <github-actions[bot]@users.noreply.github.com>',
      'github-actions[bot] <github-actions[bot]@users.noreply.github.com>',
    ]);
  });
});
