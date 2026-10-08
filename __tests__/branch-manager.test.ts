import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile as fsReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock @actions/core before importing the module under test.
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));

import { githubRemote, staleTipRejection, readCnameFile, writeIndexHtml, injectWidgetIntoSlots } from '../src/branch-manager.js';
import { WIDGET_MARKER, getWidgetScriptTag } from '../src/widget-injector.js';
import { placeContent } from '../src/content-placer.js';
import { renderIndexHtml, renderRedirectHtml } from '../src/index-renderer.js';
import type { DeploymentContext, Manifest, WidgetPlacementCounts } from '../src/types.js';
import { readFile } from 'node:fs/promises';

// withWorktree / commitAndPush run against real git in
// concurrent-deploy.test.ts.
describe('githubRemote', () => {
  it('keeps the token out of the URL and sends it only as github.com basic auth, replacing any other credential', () => {
    const remote = githubRemote('ghs_token123', 'owner/repo');
    expect(remote.url).toBe('https://x-access-token@github.com/owner/repo.git');
    const basic = Buffer.from('x-access-token:ghs_token123').toString('base64');
    expect(remote.config).toEqual([
      ['credential.helper', ''],
      ['http.https://github.com/.extraheader', ''],
      ['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${basic}`],
    ]);
  });
});

describe('staleTipRejection', () => {
  const line = (status: string) => `!\tabc123:refs/heads/gh-pages\t${status}`;
  const porcelain = (status: string) => `To https://github.com/o/r.git\n${line(status)}\nDone\n`;

  it.each([
    '[rejected] (fetch first)',
    '[rejected] (non-fast-forward)',
    '[remote rejected] (incorrect old value provided)',
    '[remote rejected] (reference already exists)',
    "[remote rejected] (cannot lock ref 'refs/heads/gh-pages': is at 1a2b3c but expected 4d5e6f)",
    "[remote rejected] (cannot lock ref 'refs/heads/gh-pages': reference already exists)",
  ])('a lost race for the tip: %s', (status) => {
    expect(staleTipRejection(porcelain(status))).toBe(line(status));
  });

  it.each([
    '[remote rejected] (pre-receive hook declined)',
    '[remote rejected] (protected branch hook declined)',
    "[remote rejected] (cannot lock ref 'refs/heads/gh-pages': 'refs/heads/gh-pages/x' exists; cannot create 'refs/heads/gh-pages')",
    "[remote rejected] (cannot lock ref 'refs/heads/gh-pages': Unable to create '/srv/repo.git/refs/heads/gh-pages.lock': File exists.)",
    '[remote rejected] (failed to update ref)',
  ])('not a race: %s', (status) => {
    expect(staleTipRejection(porcelain(status))).toBeNull();
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

  it('root index.html is a redirect, listing lives at _versions/index.html', async () => {
    await writeIndexHtml(dir, manifest, repoMeta);
    const rootContent = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(rootContent).toBe(renderRedirectHtml(manifest));
    const listingContent = await readFile(path.join(dir, '_versions', 'index.html'), 'utf8');
    expect(listingContent).toBe(renderIndexHtml(manifest, repoMeta));
  });

  it('overwrites an existing index.html', async () => {
    await writeFile(path.join(dir, 'index.html'), 'STALE CONTENT', 'utf8');
    await writeIndexHtml(dir, manifest, repoMeta);
    const content = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(content).not.toContain('STALE CONTENT');
  });

  it('is idempotent on repeated calls with same inputs', async () => {
    await writeIndexHtml(dir, manifest, repoMeta);
    const first = await readFile(path.join(dir, 'index.html'), 'utf8');
    const firstListing = await readFile(path.join(dir, '_versions', 'index.html'), 'utf8');
    await writeIndexHtml(dir, manifest, repoMeta);
    const second = await readFile(path.join(dir, 'index.html'), 'utf8');
    const secondListing = await readFile(path.join(dir, '_versions', 'index.html'), 'utf8');
    expect(first).toBe(second);
    expect(firstListing).toBe(secondListing);
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

  const siteRoot = '/widgets/';
  const noCustomization = { icon: '', label: '', position: '', color: '' };
  const slots = (m: Manifest): string[] => m.versions.map((v) => v.version);
  async function runPipelineStages(m: Manifest = manifest): Promise<WidgetPlacementCounts> {
    await writeIndexHtml(workdir, m, repoMeta);
    await placeContent(workdir, sourceDir, wctx, 'base-tag');
    return injectWidgetIntoSlots(workdir, siteRoot, slots(m), noCustomization);
  }

  it('Test 1: full pipeline injects widget into every deployed html and leaves non-html bytes intact', async () => {
    await writeSource('index.html', '<!doctype html><html><head><title>H</title></head><body><h1>Home</h1></body></html>');
    await writeSource('about/index.html', '<!doctype html><html><head><title>A</title></head><body><h2>About</h2></body></html>');
    const cssBuf = Buffer.from('body { color: red; }', 'utf8');
    const jsBuf = Buffer.from('console.log(1);', 'utf8');
    await writeSource('assets/style.css', cssBuf);
    await writeSource('assets/app.js', jsBuf);

    const injected = await runPipelineStages();
    expect(injected).toEqual({ inserted: 2, refreshed: 0, current: 0 });

    const root = await fsReadFile(path.join(workdir, versionSlot, 'index.html'), 'utf8');
    const about = await fsReadFile(path.join(workdir, versionSlot, 'about/index.html'), 'utf8');
    const slotWidget = getWidgetScriptTag({ siteRoot, manifestPath: 'versions.json', indexPath: '_versions/', currentVersion: versionSlot, ...noCustomization });
    expect(root).toContain(slotWidget);
    expect(about).toContain(slotWidget);

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

  it('Test 3: an older slot in the manifest serves the current widget; a directory outside it is untouched', async () => {
    const older = 'v0.9.0';
    const withOlder: Manifest = {
      ...manifest,
      versions: [...manifest.versions, { version: older, ref: 'refs/tags/v0.9.0', sha: 'def456', timestamp: '2026-04-01T00:00:00Z', commits: [] }],
    };
    await mkdir(path.join(workdir, older), { recursive: true });
    const olderPage = (block: string): string => `<!doctype html><html><body>old${block}</body></html>`;
    await writeFile(path.join(workdir, older, 'index.html'), olderPage(`<script>${WIDGET_MARKER}var STALE;</script>`), 'utf8');
    const stray = path.join(workdir, 'not-a-slot');
    await mkdir(stray, { recursive: true });
    const strayHtml = '<!doctype html><html><body>stray</body></html>';
    await writeFile(path.join(stray, 'index.html'), strayHtml, 'utf8');

    await writeSource('index.html', '<!doctype html><html><head></head><body>new</body></html>');
    const placed = await runPipelineStages(withOlder);

    expect(placed).toEqual({ inserted: 1, refreshed: 1, current: 0 });
    const currentWidget = getWidgetScriptTag({
      siteRoot,
      manifestPath: 'versions.json',
      indexPath: '_versions/',
      currentVersion: older,
      ...noCustomization,
    });
    expect(await fsReadFile(path.join(workdir, older, 'index.html'), 'utf8')).toBe(olderPage(currentWidget));
    expect(await fsReadFile(path.join(stray, 'index.html'), 'utf8')).toBe(strayHtml);
  });

  it('Test 4: re-running the pipeline is idempotent (exactly one marker per file)', async () => {
    await writeSource('index.html', '<!doctype html><html><head></head><body>1</body></html>');
    await writeSource('nested/page.html', '<!doctype html><html><head></head><body>2</body></html>');

    await runPipelineStages();
    const second = await injectWidgetIntoSlots(workdir, siteRoot, slots(manifest), noCustomization);
    expect(second).toEqual({ inserted: 0, refreshed: 0, current: 2 });

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
    expect(injected).toEqual({ inserted: 0, refreshed: 0, current: 0 });

    // Walk version dir, assert no marker
    const data = await fsReadFile(path.join(workdir, versionSlot, 'assets/data.json'), 'utf8');
    const svg = await fsReadFile(path.join(workdir, versionSlot, 'assets/logo.svg'), 'utf8');
    expect(data).not.toContain(WIDGET_MARKER);
    expect(svg).not.toContain(WIDGET_MARKER);
  });

  it('Test 7: a manifest slot with no directory on the branch does not stop the other slots', async () => {
    await writeSource('index.html', '<!doctype html><html><head></head><body>1</body></html>');
    const withEmptySlot: Manifest = {
      schema: 2,
      versions: [
        ...manifest.versions,
        { version: 'v0.9.0', ref: 'refs/tags/v0.9.0', sha: 'def456', timestamp: '2026-04-05T00:00:00Z', commits: [] },
      ],
    };
    expect(await runPipelineStages(withEmptySlot)).toEqual({ inserted: 1, refreshed: 0, current: 0 });
  });
});
