// The CLI deploys from the user's own clone, outside GitHub Actions: nothing masks its output and
// the repo's config is the user's. A real deploy through main() must print no token and leave
// .git/config, its refs and FETCH_HEAD untouched, even for an owner who exports their own git identity
// and rewrites github.com URLs to SSH. The GitHub URL is routed to a local bare repository by a url.<base>.insteadOf
// passed in the environment, so the remote URL the CLI builds is used as-is; GIT_TRACE records the
// argv of every git process, which is what any local user can read in the process table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';

const run = promisify(execFile);
const TOKEN = 'ghs_clideploytoken0123456789';

let root: string;
let remote: string;
let clone: string;
let output: string[];
let trace: string;

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
  trace = path.join(root, 'git-trace');
  process.env.GIT_TRACE = trace;
  process.env.GIT_AUTHOR_NAME = 'Exported Owner';
  process.env.GIT_COMMITTER_EMAIL = 'exported@example.com';
  process.env.GITHUB_SHA = await git(clone, 'rev-parse', 'HEAD');
  // Entries 1-2 are a common developer setup -- every github.com HTTPS URL rewritten to SSH. Were the
  // deploy URL to match them, git would leave for an unreachable SSH host and the deploy would fail.
  process.env.GIT_CONFIG_COUNT = '3';
  process.env.GIT_CONFIG_KEY_0 = `url.${remote}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = 'https://x-access-token@github.com/owner/repo.git';
  process.env.GIT_CONFIG_KEY_1 = 'url.ssh://git@unreachable.invalid/.insteadOf';
  process.env.GIT_CONFIG_VALUE_1 = 'https://github.com/';
  process.env.GIT_CONFIG_KEY_2 = 'url.ssh://git@unreachable.invalid/.pushInsteadOf';
  process.env.GIT_CONFIG_VALUE_2 = 'https://github.com/';

  vi.spyOn(process, 'cwd').mockReturnValue(clone);
  output = [];
  const capture = (chunk: unknown): boolean => (output.push(String(chunk)), true);
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of ['GITHUB_SHA', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1', 'GIT_CONFIG_KEY_2', 'GIT_CONFIG_VALUE_2', 'GIT_TRACE', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL']) {
    delete process.env[key];
  }
  await rm(root, { recursive: true, force: true });
});

describe('cli deploy against a real remote', () => {
  it('namespace-storage wraps the deployed slot only, and every wrapped slot is re-placed on later deploys', async () => {
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>site</body></html>');
    const deployRef = (ref: string, ...flags: string[]): Promise<number> =>
      main(['deploy', `--source-dir=${site}`, '--repo=owner/repo', `--ref=${ref}`, ...flags], { GITHUB_TOKEN: TOKEN });

    expect(await deployRef('refs/tags/v1.0.0', '--namespace-storage')).toBe(0);
    expect(await deployRef('refs/tags/v2.0.0')).toBe(0);

    expect(output.filter((line) => line.startsWith('Deployed '))).toEqual([
      'Deployed v1.0.0 to https://owner.github.io/repo/v1.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 0 refreshed, 0 current; storage wrapper 1 inserted, 0 refreshed, 0 current, every-page in v1.0.0; sitemap 1 URL(s): 1 from v1.0.0, 0 from older versions; renamed 0 slot(s))\n',
      'Deployed v2.0.0 to https://owner.github.io/repo/v2.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 0 refreshed, 1 current; storage wrapper 0 inserted, 0 refreshed, 1 current, wrapped-pages in v2.0.0; sitemap 1 URL(s): 1 from v2.0.0, 0 from older versions; renamed 0 slot(s))\n',
    ]);
    const shown = (file: string): Promise<string> => git(root, '--git-dir', remote, 'show', `gh-pages:${file}`);
    expect(await shown('v1.0.0/index.html')).toContain('"gh-pm:owner/repo/v1.0.0:"');
    expect(await shown('v2.0.0/index.html')).not.toContain('gh-pages-multiplexer:storage-wrapper');
  });

  it('deploys a version named for a root entry beside that entry, leaving the manifest and version index intact', async () => {
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>site</body></html>');
    const deploy = (...flags: string[]): Promise<number> =>
      main(['deploy', `--source-dir=${site}`, '--repo=owner/repo', ...flags], { GITHUB_TOKEN: TOKEN });

    expect(await deploy('--ref=refs/heads/main', '--deploy-version=versions.json')).toBe(0);
    expect(await deploy('--ref=refs/tags/_versions')).toBe(0);

    expect(output.filter((line) => line.startsWith('Deployed ')).map((line) => line.split(' (')[0])).toEqual([
      'Deployed ~76ersions.json to https://owner.github.io/repo/~76ersions.json/',
      'Deployed ~5Fversions to https://owner.github.io/repo/~5Fversions/',
    ]);
    const shown = (file: string): Promise<string> => git(root, '--git-dir', remote, 'show', `gh-pages:${file}`);
    expect(JSON.parse(await shown('versions.json')).versions.map((v: { version: string }) => v.version)).toEqual(['~5Fversions', '~76ersions.json']);
    expect(await shown('_versions/index.html')).toContain('~76ersions.json');
    expect(await shown('_versions/stats.html')).toContain('../versions.json');
    expect(await shown('~5Fversions/index.html')).toContain('<base href="/repo/~5Fversions/">');
  });

  it('publishes without exposing the token or touching the clone\'s config, refs or FETCH_HEAD', async () => {
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>v1</body></html>');
    const configBefore = await readFile(path.join(clone, '.git', 'config'));
    const refsBefore = await git(clone, 'for-each-ref');

    const argv = ['deploy', `--source-dir=${site}`, '--repo=owner/repo', '--ref=refs/tags/v1.0.0'];
    // Twice: the second deploy takes the existing-branch path (ls-remote hit, fetch, non-root commit).
    expect(await main(argv, { GITHUB_TOKEN: TOKEN })).toBe(0);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>v1 again</body></html>');
    expect(await main(argv, { GITHUB_TOKEN: TOKEN })).toBe(0);

    // The second deploy re-places v1.0.0's content, so its one page gets the widget inserted again.
    expect(output.filter((line) => line.startsWith('Deployed v1.0.0'))).toEqual([
      'Deployed v1.0.0 to https://owner.github.io/repo/v1.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 0 refreshed, 0 current; storage wrapper 0 inserted, 0 refreshed, 0 current, wrapped-pages in v1.0.0; sitemap 1 URL(s): 1 from v1.0.0, 0 from older versions; renamed 0 slot(s))\n',
      'Deployed v1.0.0 to https://owner.github.io/repo/v1.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 0 refreshed, 0 current; storage wrapper 0 inserted, 0 refreshed, 0 current, wrapped-pages in v1.0.0; sitemap 1 URL(s): 1 from v1.0.0, 0 from older versions; renamed 0 slot(s))\n',
    ]);
    expect(output.filter((line) => line.includes(TOKEN))).toEqual([]);
    expect(await readFile(path.join(clone, '.git', 'config'))).toEqual(configBefore);
    expect(await git(clone, 'for-each-ref')).toBe(refsBefore);
    expect(existsSync(path.join(clone, '.git', 'FETCH_HEAD'))).toBe(false);
    const traced = await readFile(trace, 'utf8');
    expect(traced).toContain('git push --porcelain https://x-access-token@github.com/owner/repo.git');
    expect(traced).not.toContain(TOKEN);
    expect(traced).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString('base64'));
    const bot = 'github-actions[bot] <github-actions[bot]@users.noreply.github.com>';
    const log = await git(root, '--git-dir', remote, 'log', '--format=%an <%ae>|%cn <%ce>', 'gh-pages');
    expect(log.split('\n')).toEqual([`${bot}|${bot}`, `${bot}|${bot}`]);
  });

  it('renames a slot deployed before the slot-name rule, rebasing its pages, and links it raw everywhere', async () => {
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), '<html><head></head><body>site</body></html>');
    const deployRef = (ref: string): Promise<number> =>
      main(['deploy', `--source-dir=${site}`, '--repo=owner/repo', `--ref=${ref}`], { GITHUB_TOKEN: TOKEN });
    expect(await deployRef('refs/tags/v1-rc')).toBe(0);

    // What an earlier release left for the tag v1#rc: its slot, base path and manifest entry name it raw.
    const pages = path.join(root, 'pages');
    await run('git', ['clone', '--quiet', '--branch', 'gh-pages', remote, pages]);
    await git(pages, 'mv', 'v1-rc', 'v1#rc');
    const page = path.join(pages, 'v1#rc', 'index.html');
    await writeFile(page, (await readFile(page, 'utf8')).replaceAll('/repo/v1-rc/', '/repo/v1#rc/'));
    const manifestFile = path.join(pages, 'versions.json');
    await writeFile(manifestFile, (await readFile(manifestFile, 'utf8')).replace('"version": "v1-rc"', '"version": "v1#rc"'));
    await git(pages, 'add', '-A');
    await git(pages, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'legacy slot');
    await git(pages, 'push', '--quiet', 'origin', 'gh-pages');

    expect(await deployRef('refs/tags/v2.0.0')).toBe(0);

    expect(output.filter((line) => line.startsWith('Deployed v2.0.0'))).toEqual([
      'Deployed v2.0.0 to https://owner.github.io/repo/v2.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 1 refreshed, 0 current; storage wrapper 0 inserted, 0 refreshed, 0 current, wrapped-pages in v2.0.0; sitemap 1 URL(s): 1 from v2.0.0, 0 from older versions; renamed 1 slot(s) v1#rc -> v1~23rc (1 page(s) rebased))\n',
    ]);
    const shown = (file: string): Promise<string> => git(root, '--git-dir', remote, 'show', `gh-pages:${file}`);
    expect(await shown('v1~23rc/index.html')).toContain('<base href="/repo/v1~23rc/">');
    expect(await git(root, '--git-dir', remote, 'ls-tree', '--name-only', 'gh-pages')).not.toContain('v1#rc');
    expect(JSON.parse(await shown('versions.json')).versions.map((v: { version: string }) => v.version)).toEqual(['v2.0.0', 'v1~23rc']);
    expect(await shown('_versions/index.html')).toContain('<a href="../v1~23rc/">');
  });

  it('canonicalizes a page the latest version dropped to the newest version that still has it, and lists it in the sitemap', async () => {
    const site = path.join(root, 'site');
    await mkdir(path.join(site, 'docs'), { recursive: true });
    const page = '<html><head></head><body>site</body></html>';
    await writeFile(path.join(site, 'index.html'), page);
    await writeFile(path.join(site, 'docs', 'old.html'), page);
    const deployRef = (ref: string): Promise<number> =>
      main(['deploy', `--source-dir=${site}`, '--repo=owner/repo', `--ref=${ref}`], { GITHUB_TOKEN: TOKEN });
    expect(await deployRef('refs/tags/v1.0.0')).toBe(0);
    expect(await deployRef('refs/tags/v1.1.0')).toBe(0);
    await rm(path.join(site, 'docs'), { recursive: true });
    expect(await deployRef('refs/tags/v2.0.0')).toBe(0);

    expect(output.filter((line) => line.startsWith('Deployed v2.0.0'))).toEqual([
      'Deployed v2.0.0 to https://owner.github.io/repo/v2.0.0/ (pushed, 1 publish attempt(s); nav widget 1 inserted, 0 refreshed, 4 current; storage wrapper 0 inserted, 0 refreshed, 0 current, wrapped-pages in v2.0.0; sitemap 2 URL(s): 1 from v2.0.0, 1 from older versions; renamed 0 slot(s))\n',
    ]);
    const shown = (file: string): Promise<string> => git(root, '--git-dir', remote, 'show', `gh-pages:${file}`);
    const canonical = (url: string): string => `<link rel="canonical" href="${url}">`;
    for (const slot of ['v1.0.0', 'v1.1.0']) {
      expect(await shown(`${slot}/docs/old.html`)).toContain(canonical('https://owner.github.io/repo/v1.1.0/docs/old.html'));
      expect(await shown(`${slot}/index.html`)).toContain(canonical('https://owner.github.io/repo/v2.0.0/index.html'));
    }
    const locs = [...(await shown('sitemap.xml')).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual([
      'https://owner.github.io/repo/v1.1.0/docs/old.html',
      'https://owner.github.io/repo/v2.0.0/index.html',
    ]);
  });
});
