import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile as fsReadFile } from 'node:fs/promises';
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
import { prepareBranch, commitAndPush, cleanupWorktree, readCnameFile, writeIndexHtml, injectWidgetForVersion } from '../src/branch-manager.js';
import { WIDGET_MARKER } from '../src/widget-injector.js';
import { placeContent } from '../src/content-placer.js';
import { renderIndexHtml } from '../src/index-renderer.js';
import type { DeployConfig, DeploymentContext, Manifest } from '../src/types.js';
import { readFile } from 'node:fs/promises';

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
  version: '',
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

describe('writeIndexHtml', () => {
  let dir: string;
  const manifest: Manifest = {
    schema: 2,
    versions: [
      {
        version: 'v1.2.3',
        ref: 'refs/tags/v1.2.3',
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        timestamp: '2026-04-06T00:00:00Z',
        commits: [],
      },
    ],
  };
  const repoMeta = { owner: 'acme', repo: 'widgets' };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'widx-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes index.html to workdir', async () => {
    await writeIndexHtml(dir, manifest, repoMeta);
    const content = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('content matches renderIndexHtml output', async () => {
    await writeIndexHtml(dir, manifest, repoMeta);
    const content = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(content).toBe(renderIndexHtml(manifest, repoMeta));
  });

  it('overwrites an existing index.html', async () => {
    await writeFile(path.join(dir, 'index.html'), 'STALE CONTENT', 'utf8');
    await writeIndexHtml(dir, manifest, repoMeta);
    const content = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(content).not.toContain('STALE CONTENT');
    expect(content).toContain('v1.2.3');
  });

  it('is idempotent on repeated calls with same inputs', async () => {
    await writeIndexHtml(dir, manifest, repoMeta);
    const first = await readFile(path.join(dir, 'index.html'), 'utf8');
    await writeIndexHtml(dir, manifest, repoMeta);
    const second = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(first).toBe(second);
  });
});

describe('widget injection in deploy pipeline', () => {
  let workdir: string;
  let sourceDir: string;
  const versionSlot = 'v1.0.0';
  const repoMeta = { owner: 'acme', repo: 'widgets' };
  const wctx: DeploymentContext = {
    versionSlot,
    originalRef: 'refs/tags/v1.0.0',
    sha: 'abc123',
    timestamp: '2026-04-06T00:00:00Z',
    basePath: '/widgets/v1.0.0/',
  };
  const manifest: Manifest = {
    schema: 2,
    versions: [
      { version: versionSlot, ref: 'refs/tags/v1.0.0', sha: 'abc123', timestamp: '2026-04-06T00:00:00Z', commits: [] },
    ],
  };

  function markerCount(content: string): number {
    return (content.match(/gh-pages-multiplexer:nav-widget/g) || []).length;
  }

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), 'wpipe-wd-'));
    sourceDir = await mkdtemp(path.join(tmpdir(), 'wpipe-src-'));
  });
  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  async function writeSource(rel: string, content: string | Buffer): Promise<void> {
    const full = path.join(sourceDir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  async function runPipelineStages(): Promise<number> {
    await writeIndexHtml(workdir, manifest, repoMeta);
    await placeContent(workdir, sourceDir, wctx, 'base-tag');
    return injectWidgetForVersion(workdir, versionSlot, repoMeta);
  }

  it('Test 1: full pipeline injects widget into every deployed html and leaves non-html bytes intact', async () => {
    await writeSource('index.html', '<!doctype html><html><head><title>H</title></head><body><h1>Home</h1></body></html>');
    await writeSource('about/index.html', '<!doctype html><html><head><title>A</title></head><body><h2>About</h2></body></html>');
    const cssBuf = Buffer.from('body { color: red; }', 'utf8');
    const jsBuf = Buffer.from('console.log(1);', 'utf8');
    await writeSource('assets/style.css', cssBuf);
    await writeSource('assets/app.js', jsBuf);

    const injected = await runPipelineStages();
    expect(injected).toBe(2);

    const root = await fsReadFile(path.join(workdir, versionSlot, 'index.html'), 'utf8');
    const about = await fsReadFile(path.join(workdir, versionSlot, 'about/index.html'), 'utf8');
    expect(root).toContain(WIDGET_MARKER);
    expect(about).toContain(WIDGET_MARKER);
    expect(root).toContain(`"${versionSlot}"`);
    expect(about).toContain(`"${versionSlot}"`);
    expect(root).toContain('"../versions.json"');
    expect(about).toContain('"../versions.json"');

    const css = await fsReadFile(path.join(workdir, versionSlot, 'assets/style.css'));
    const js = await fsReadFile(path.join(workdir, versionSlot, 'assets/app.js'));
    expect(Buffer.compare(css, cssBuf)).toBe(0);
    expect(Buffer.compare(js, jsBuf)).toBe(0);
  });

  it('Test 2: root index.html (rendered by index-renderer) is NOT injected', async () => {
    await writeSource('index.html', '<!doctype html><html><head></head><body>x</body></html>');
    await runPipelineStages();
    const rootIdx = await fsReadFile(path.join(workdir, 'index.html'), 'utf8');
    expect(rootIdx).not.toContain(WIDGET_MARKER);
  });

  it('Test 3: sibling version directories are byte-identical after deploy', async () => {
    const siblingDir = path.join(workdir, 'v0.9.0');
    await mkdir(siblingDir, { recursive: true });
    const siblingHtml = '<!doctype html><html><body>old</body></html>';
    await writeFile(path.join(siblingDir, 'index.html'), siblingHtml, 'utf8');

    await writeSource('index.html', '<!doctype html><html><head></head><body>new</body></html>');
    await runPipelineStages();

    const after = await fsReadFile(path.join(siblingDir, 'index.html'), 'utf8');
    expect(after).toBe(siblingHtml);
    expect(after).not.toContain(WIDGET_MARKER);
  });

  it('Test 4: re-running the pipeline is idempotent (exactly one marker per file)', async () => {
    await writeSource('index.html', '<!doctype html><html><head></head><body>1</body></html>');
    await writeSource('nested/page.html', '<!doctype html><html><head></head><body>2</body></html>');

    await runPipelineStages();
    const second = await injectWidgetForVersion(workdir, versionSlot, repoMeta);
    expect(second).toBe(0);

    const a = await fsReadFile(path.join(workdir, versionSlot, 'index.html'), 'utf8');
    const b = await fsReadFile(path.join(workdir, versionSlot, 'nested/page.html'), 'utf8');
    expect(markerCount(a)).toBe(1);
    expect(markerCount(b)).toBe(1);
  });

  it('Test 5: widget injection runs AFTER placeContent (base-path correction + marker coexist)', async () => {
    await writeSource('index.html', '<!doctype html><html><head><title>T</title></head><body><a href="#top">top</a></body></html>');
    await runPipelineStages();
    const out = await fsReadFile(path.join(workdir, versionSlot, 'index.html'), 'utf8');
    // placeContent injected <base href="..."> via injectBaseHref
    expect(out).toContain('<base href="/widgets/v1.0.0/">');
    // and the widget marker is also present
    expect(out).toContain(WIDGET_MARKER);
    // marker appears once, after the <base> tag => proves order
    expect(out.indexOf(WIDGET_MARKER)).toBeGreaterThan(out.indexOf('<base href='));
  });

  it('Test 6: zero-html version is a no-op success', async () => {
    await writeSource('assets/data.json', '{"k":1}');
    await writeSource('assets/logo.svg', '<svg/>');

    const injected = await runPipelineStages();
    expect(injected).toBe(0);

    // Walk version dir, assert no marker
    const data = await fsReadFile(path.join(workdir, versionSlot, 'assets/data.json'), 'utf8');
    const svg = await fsReadFile(path.join(workdir, versionSlot, 'assets/logo.svg'), 'utf8');
    expect(data).not.toContain(WIDGET_MARKER);
    expect(svg).not.toContain(WIDGET_MARKER);
  });
});
