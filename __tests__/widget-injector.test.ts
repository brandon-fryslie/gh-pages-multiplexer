import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, chmod, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as core from '@actions/core';
import { JSDOM, VirtualConsole, requestInterceptor } from 'jsdom';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import {
  getWidgetScriptTag,
  injectWidgetIntoHtmlFiles,
  WIDGET_MARKER,
} from '../src/widget-injector.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(os.tmpdir(), 'widget-injector-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
  vi.mocked(core.info).mockClear();
  vi.mocked(core.warning).mockClear();
});

const opts = {
  manifestPath: 'versions.json',
  indexPath: '_versions/',
  currentVersion: 'v1.0.0',
  icon: '',
  label: '',
  position: '',
  color: '',
};

describe('getWidgetScriptTag (pure)', () => {
  it('Test 1: contains marker comment', () => {
    const out = getWidgetScriptTag(opts, '../');
    expect(out).toContain(WIDGET_MARKER);
    expect(out).toContain('<!-- gh-pages-multiplexer:nav-widget -->');
  });

  it('Test 2: is a script element', () => {
    const out = getWidgetScriptTag(opts, '../').trim();
    expect(out.startsWith('<script')).toBe(true);
    expect(out.endsWith('</script>')).toBe(true);
  });

  it('Test 3: inlines opts values', () => {
    const out = getWidgetScriptTag({
      manifestPath: 'versions.json',
      indexPath: '_versions/',
      currentVersion: 'v1.2.3',
      icon: '',
      label: '',
      position: '',
      color: '',
    }, '../');
    expect(out).toContain('versions.json');
    expect(out).toContain('_versions/');
    expect(out).toContain('v1.2.3');
  });

  it('Test 4: contains custom element name gh-pm-nav', () => {
    const out = getWidgetScriptTag(opts, '../');
    expect(out).toContain('gh-pm-nav');
  });

  it('Test 5: uses Shadow DOM mode open', () => {
    const out = getWidgetScriptTag(opts, '../');
    const hasOpen =
      /mode:\s*['"]open['"]/.test(out);
    expect(hasOpen).toBe(true);
  });

  it('Test 6: IIFE-wrapped, no top-level globals', () => {
    const out = getWidgetScriptTag(opts, '../');
    // Extract body between first <script...> and last </script>
    const bodyMatch = out.match(/<script[^>]*>([\s\S]*)<\/script>\s*$/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1];
    // Strip the marker comment line
    const stripped = body.replace(WIDGET_MARKER, '').trim();
    // Must start with ( for IIFE
    expect(stripped.startsWith('(')).toBe(true);
    // IIFE pattern
    const iifeFn = /\(function\s*\(\s*\)\s*\{[\s\S]*\}\s*\)\s*\(\s*\)\s*;?/;
    const iifeArrow = /\(\s*\(\s*\)\s*=>\s*\{[\s\S]*\}\s*\)\s*\(\s*\)/;
    expect(iifeFn.test(stripped) || iifeArrow.test(stripped)).toBe(true);
  });

  it('Test 7: contains no external network references at injection time', () => {
    const out = getWidgetScriptTag(opts, '../');
    expect(out).not.toMatch(/\bsrc=/);
    expect(out).not.toMatch(/<link\b/);
    expect(out).not.toMatch(/import\(['"]http/);
    expect(out).not.toMatch(/fetch\(['"]http/);
  });

  it('Test 8: escapes currentVersion to prevent script breakout', () => {
    const evil = "v1'\"</script>";
    const out = getWidgetScriptTag({
      manifestPath: 'versions.json',
      indexPath: '_versions/',
      currentVersion: evil,
      icon: '',
      label: '',
      position: '',
      color: '',
    }, '../');
    // first </script> must be at the very end
    const firstClose = out.indexOf('</script>');
    const lastClose = out.lastIndexOf('</script>');
    expect(firstClose).toBe(lastClose);
    // Raw evil string must not appear
    expect(out).not.toContain(evil);
  });

  it('Test 21: custom icon SVG is inlined and resolvable at runtime', () => {
    const customIcon = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const out = getWidgetScriptTag({ ...opts, icon: customIcon }, '../');
    // The SVG markup ends up inside a JS string in the inlined script.
    // JSON.stringify escapes some chars; we just confirm a recognizable substring.
    expect(out).toContain('circle cx');
    expect(out).toContain('viewBox');
  });

  it('Test 22: custom label with {version} token gets the placeholder substituted at runtime', () => {
    // We can't run the JS here, but we can verify the substitution code is present
    // and the literal label template is inlined.
    const out = getWidgetScriptTag({ ...opts, label: 'Docs {version}' }, '../');
    expect(out).toContain('Docs {version}');
    expect(out).toContain("LABEL_TEMPLATE.split('{version}').join(CURRENT)");
  });

  it('Test 23: custom widget-position is inlined verbatim', () => {
    const out = getWidgetScriptTag({ ...opts, position: 'left 50%' }, '../');
    expect(out).toContain('left 50%');
  });

  it('Test 24: custom widget-color is inlined and applied to --handle-bg at runtime', () => {
    const out = getWidgetScriptTag({ ...opts, color: '#10b981' }, '../');
    expect(out).toContain('#10b981');
    expect(out).toContain("setProperty('--handle-bg'");
  });

  it('Test 25: defaults are used when opts fields are empty strings', () => {
    const out = getWidgetScriptTag(opts, '../');
    // Default icon: layers SVG paths
    expect(out).toContain('M12.83 2.18');
    // Default label template: {version}
    expect(out).toContain('{version}');
    // Default position: right 80%
    expect(out).toContain('right 80%');
    // Default color: bright orange
    expect(out).toContain('#f97316');
  });

  it('Test 9: deterministic / pure', () => {
    expect(getWidgetScriptTag(opts, '../')).toBe(getWidgetScriptTag(opts, '../'));
  });
});

describe('injectWidgetIntoHtmlFiles (I/O)', () => {
  it('Test 10: basic injection before </body>', async () => {
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><body><h1>hi</h1></body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 1, refreshed: 0, current: 0 });
    const content = await readFile(file, 'utf8');
    expect(content).toContain(WIDGET_MARKER);
    expect(content).toContain('<h1>hi</h1>');
    const scriptIdx = content.indexOf('<script');
    const bodyIdx = content.indexOf('</body>');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyIdx);
    // Nothing between script end and </body> except the script tag itself
    expect(content).toMatch(/<\/script>\s*<\/body>/);
  });

  it('Test 11: recursive walk', async () => {
    await writeFile(path.join(workdir, 'index.html'), '<html><body>a</body></html>', 'utf8');
    await mkdir(path.join(workdir, 'sub', 'deeper'), { recursive: true });
    await writeFile(path.join(workdir, 'sub', 'page.html'), '<html><body>b</body></html>', 'utf8');
    await writeFile(path.join(workdir, 'sub', 'deeper', 'three.html'), '<html><body>c</body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 3, refreshed: 0, current: 0 });
    for (const f of ['index.html', 'sub/page.html', 'sub/deeper/three.html']) {
      const c = await readFile(path.join(workdir, f), 'utf8');
      expect(c).toContain(WIDGET_MARKER);
    }
  });

  it('Test 12: idempotency (D-12)', async () => {
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><body>x</body></html>', 'utf8');
    const n1 = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n1).toEqual({ inserted: 1, refreshed: 0, current: 0 });
    const after1 = await readFile(file, 'utf8');
    const n2 = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n2).toEqual({ inserted: 0, refreshed: 0, current: 1 });
    const after2 = await readFile(file, 'utf8');
    expect(after2).toBe(after1);
    const matches = after2.match(/gh-pages-multiplexer:nav-widget/g) || [];
    expect(matches.length).toBe(1);
  });

  it('Test 13: non-html files untouched (D-13)', async () => {
    await writeFile(path.join(workdir, 'index.html'), '<html><body>a</body></html>', 'utf8');
    const css = 'body { color: red; }';
    const js = 'console.log(1);';
    const json = '{"a":1}';
    const svg = '<svg/>';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(path.join(workdir, 'style.css'), css, 'utf8');
    await writeFile(path.join(workdir, 'app.js'), js, 'utf8');
    await writeFile(path.join(workdir, 'data.json'), json, 'utf8');
    await writeFile(path.join(workdir, 'pic.svg'), svg, 'utf8');
    await writeFile(path.join(workdir, 'image.png'), png);
    await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(await readFile(path.join(workdir, 'style.css'), 'utf8')).toBe(css);
    expect(await readFile(path.join(workdir, 'app.js'), 'utf8')).toBe(js);
    expect(await readFile(path.join(workdir, 'data.json'), 'utf8')).toBe(json);
    expect(await readFile(path.join(workdir, 'pic.svg'), 'utf8')).toBe(svg);
    expect((await readFile(path.join(workdir, 'image.png'))).equals(png)).toBe(true);
    expect(await readFile(path.join(workdir, 'index.html'), 'utf8')).toContain(WIDGET_MARKER);
  });

  it('Test 14: case-insensitive .html', async () => {
    const file = path.join(workdir, 'Page.HTML');
    await writeFile(file, '<html><body>x</body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 1, refreshed: 0, current: 0 });
    expect(await readFile(file, 'utf8')).toContain(WIDGET_MARKER);
  });

  it('Test 15: missing </body>, fallback to </html> (D-14)', async () => {
    const warnMock = vi.mocked(core.warning);
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><h1>no body close</h1></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 1, refreshed: 0, current: 0 });
    const content = await readFile(file, 'utf8');
    expect(content).toContain(WIDGET_MARKER);
    expect(content).toMatch(/<\/script>\s*<\/html>/);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('Test 16: missing </body> AND </html>, append+warn (D-14)', async () => {
    const warnMock = vi.mocked(core.warning);
    const file = path.join(workdir, 'frag.html');
    await writeFile(file, '<h1>fragment</h1>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 1, refreshed: 0, current: 0 });
    const content = await readFile(file, 'utf8');
    expect(content).toContain(WIDGET_MARKER);
    expect(warnMock).toHaveBeenCalled();
    const msg = (warnMock.mock.calls[0]?.[0] as string) || '';
    expect(msg).toContain('frag.html');
  });

  it('Test 17: zero html files no-op success (D-17)', async () => {
    const infoMock = vi.mocked(core.info);
    await writeFile(path.join(workdir, 'style.css'), 'body{}', 'utf8');
    await writeFile(path.join(workdir, 'data.json'), '{}', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 0, refreshed: 0, current: 0 });
    const calls = infoMock.mock.calls.map((c) => String(c[0])).join('\n');
    expect(/0 HTML|no widget injection/i.test(calls)).toBe(true);
  });

  it('Test 17b: a slot with no directory has zero pages', async () => {
    const n = await injectWidgetIntoHtmlFiles(path.join(workdir, 'never-committed'), opts);
    expect(n).toEqual({ inserted: 0, refreshed: 0, current: 0 });
  });

  it('Test 18: errors propagate (D-16)', async () => {
    const notADir = path.join(workdir, 'slot');
    await writeFile(notADir, 'x', 'utf8');
    await expect(injectWidgetIntoHtmlFiles(notADir, opts)).rejects.toThrow(/ENOTDIR/);
  });

  it('Test 19: preserves rest of HTML', async () => {
    const file = path.join(workdir, 'index.html');
    const html =
      '<!doctype html><html lang="en"><head><title>x</title></head><body><main>content</main></body></html>';
    await writeFile(file, html, 'utf8');
    await injectWidgetIntoHtmlFiles(workdir, opts);
    const out = await readFile(file, 'utf8');
    const parts = ['<!doctype html>', '<title>x</title>', '<main>content</main>', '</body>', '</html>'];
    let cursor = 0;
    for (const p of parts) {
      const idx = out.indexOf(p, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx + p.length;
    }
  });

  it('Test 20: a page carrying an earlier widget gets the current one in its place', async () => {
    const stale = path.join(workdir, 'stale.html');
    const fresh = path.join(workdir, 'fresh.html');
    // The shape every earlier template emitted: the marker opens the script, the first </script> ends it.
    const staleBlock = `<script>${WIDGET_MARKER}\n(function(){ var OLD = '<\\/div>'; })();\n</script>`;
    await writeFile(stale, `<html><body><p>keep</p>${staleBlock}<footer>also</footer></body></html>`, 'utf8');
    await writeFile(fresh, '<html><body>b</body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toEqual({ inserted: 1, refreshed: 1, current: 0 });
    expect(await readFile(stale, 'utf8')).toBe(
      `<html><body><p>keep</p>${getWidgetScriptTag(opts, '../')}<footer>also</footer></body></html>`,
    );
    expect(await readFile(fresh, 'utf8')).toContain(WIDGET_MARKER);
  });

  it('Test 20b: the rendered widget closes its script exactly once, at its end', () => {
    // Refreshing relies on this: a block ends at the first </script> after its marker.
    const hostile = { ...opts, currentVersion: '</script><b>x', label: '</script>', icon: '<svg></svg>' };
    const tag = getWidgetScriptTag(hostile, '../');
    expect(tag.indexOf('</script>')).toBe(tag.length - '</script>'.length);
  });

  it('Test 20c: a widget block with no closing tag fails loudly', async () => {
    await writeFile(path.join(workdir, 'cut.html'), `<html><body><script>${WIDGET_MARKER} var x;`, 'utf8');
    await expect(injectWidgetIntoHtmlFiles(workdir, opts)).rejects.toThrow(/cut\.html.*no closing <\/script>/);
  });
});

// ---- Runtime behavior (jsdom) -----------------------------------------------
// Serves pages at real URLs and runs the real injected script in them, top-level and framed.

describe('injected widget at runtime', () => {
  type Decision = { site: string; sameOriginAncestors: number; mounted: boolean; yieldedTo: string | null };

  const SITE = 'https://u.github.io/repo/v1.0.0/';
  const WIDGET = getWidgetScriptTag(opts, '../');
  const NESTED_WIDGET = getWidgetScriptTag(opts, '../../');
  const page = (body: string): string => `<!doctype html><html><body>${body}</body></html>`;
  const widgetBody = (): string => {
    const m = /^<script>([\s\S]*)<\/script>$/.exec(WIDGET);
    if (!m) throw new Error('widget tag is not a single <script> element');
    return m[1];
  };

  const doms: JSDOM[] = [];
  afterEach(() => {
    for (const dom of doms.splice(0)) dom.window.close();
  });

  // Every page and script is served from `pages`; a Promise value holds the response back.
  const load = (url: string, pages: Record<string, string | Promise<string>>) => {
    const decisions: Decision[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('debug', (tag: string, fact: Decision) => {
      if (tag === 'gh-pm-nav') decisions.push(fact);
    });
    const served = requestInterceptor(async (request: Request) => {
      if (!(request.url in pages)) throw new Error(`unexpected fetch ${request.url}`);
      const body = await pages[request.url];
      const type = request.url.endsWith('.js') ? 'text/javascript' : 'text/html';
      return new Response(body, { headers: { 'content-type': type } });
    });
    const dom = new JSDOM(pages[url] as string, {
      url,
      runScripts: 'dangerously',
      resources: { interceptors: [served] },
      virtualConsole,
    });
    doms.push(dom);
    // Each widget emits exactly one decision; wait for that, not a timer.
    const decided = (n: number): Promise<Decision[]> =>
      new Promise((resolve) => {
        const check = (): void => {
          if (decisions.length >= n) resolve(decisions);
        };
        virtualConsole.on('debug', check);
        check();
      });
    const navs = (doc: Document): number => doc.querySelectorAll('gh-pm-nav').length;
    const frame = (): Document => dom.window.document.querySelector('iframe')!.contentDocument!;
    return { dom, decided, navs, frame, virtualConsole };
  };

  it('links every page to the site root, at any depth below its slot', async () => {
    const slot = path.join(workdir, 'v1.0.0');
    await mkdir(path.join(slot, 'docs', 'guide'), { recursive: true });
    const file = path.join(slot, 'docs', 'guide', 'a.html');
    await writeFile(file, page('guide'), 'utf8');
    await injectWidgetIntoHtmlFiles(slot, opts);

    const fetched: string[] = [];
    const dom = new JSDOM(await readFile(file, 'utf8'), {
      url: `${SITE}docs/guide/a.html`,
      runScripts: 'dangerously',
      beforeParse(window) {
        window.fetch = (async (url: string) => {
          fetched.push(url);
          const manifest = { versions: [{ version: 'v1.0.0', ref: 'a' }, { version: 'v2.0.0', ref: 'b' }] };
          return { ok: true, json: async () => manifest };
        }) as unknown as typeof fetch;
      },
    });
    doms.push(dom);
    await new Promise((resolve) => dom.window.addEventListener('load', resolve));
    const nav = dom.window.document.querySelector('gh-pm-nav')!.shadowRoot!;
    (nav.querySelector('.handle') as HTMLElement).click();
    await vi.waitFor(() => expect(nav.querySelector('a.row')).not.toBeNull());

    expect(fetched).toEqual(['https://u.github.io/repo/versions.json']);
    expect(nav.querySelector('.index-link')!.getAttribute('href')).toBe('https://u.github.io/repo/_versions/');
    expect(nav.querySelector('a.row')!.getAttribute('href')).toBe('https://u.github.io/repo/v2.0.0/');
  });

  it('mounts one switcher in a top-level page', async () => {
    const { dom, decided, navs } = load(SITE, { [SITE]: page(WIDGET) });
    expect(await decided(1)).toEqual([
      { site: '/repo/', sameOriginAncestors: 0, mounted: true, yieldedTo: null },
    ]);
    expect(navs(dom.window.document)).toBe(1);
  });

  it('leaves the switcher to a parent running the same site\'s widget, at any depth', async () => {
    const { dom, decided, navs, frame } = load(SITE, {
      [SITE]: page(`<iframe src="demo/live.html"></iframe>${WIDGET}`),
      [`${SITE}demo/live.html`]: page(NESTED_WIDGET),
    });
    expect(await decided(2)).toContainEqual(
      { site: '/repo/', sameOriginAncestors: 1, mounted: false, yieldedTo: SITE },
    );
    expect(navs(dom.window.document)).toBe(1);
    expect(navs(frame())).toBe(0);
  });

  it('mounts in a frame whose same-origin parent has no widget', async () => {
    // Another project site on the shared <user>.github.io origin embedding a deployed page.
    const blog = 'https://u.github.io/blog/';
    const { decided, navs, frame } = load(blog, {
      [blog]: page(`<iframe src="${SITE}"></iframe>`),
      [SITE]: page(WIDGET),
    });
    expect(await decided(1)).toEqual([
      { site: '/repo/', sameOriginAncestors: 1, mounted: true, yieldedTo: null },
    ]);
    expect(navs(frame())).toBe(1);
  });

  it('mounts in a frame whose same-origin parent runs another site\'s widget', async () => {
    const other = 'https://u.github.io/other/v1.0.0/';
    const { decided, navs, frame } = load(other, {
      [other]: page(`<iframe src="${SITE}"></iframe>${WIDGET}`),
      [SITE]: page(WIDGET),
    });
    expect(await decided(2)).toContainEqual(
      { site: '/repo/', sameOriginAncestors: 1, mounted: true, yieldedTo: null },
    );
    expect(navs(frame())).toBe(1);
  });

  it('waits for a parent still parsing toward its own widget', async () => {
    // The parent's widget is a blocking external script released only once the frame has
    // loaded, so the frame decides while the parent is still parsing.
    let release!: (body: string) => void;
    const held = new Promise<string>((r) => (release = r));
    const { dom, decided, navs, frame, virtualConsole } = load(SITE, {
      [SITE]: page(
        `<iframe src="demo/live.html" onload="console.log('frame-loaded')"></iframe>` +
          `<script src="widget.js"></script>`,
      ),
      [`${SITE}demo/live.html`]: page(NESTED_WIDGET),
      [`${SITE}widget.js`]: held,
    });
    virtualConsole.on('log', (msg: string) => {
      if (msg === 'frame-loaded') release(widgetBody());
    });
    expect(await decided(2)).toContainEqual(
      { site: '/repo/', sameOriginAncestors: 1, mounted: false, yieldedTo: SITE },
    );
    expect(navs(dom.window.document)).toBe(1);
    expect(navs(frame())).toBe(0);
  });
});
