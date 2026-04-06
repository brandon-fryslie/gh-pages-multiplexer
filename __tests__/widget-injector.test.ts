import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, chmod, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as core from '@actions/core';

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
  manifestUrl: '../versions.json',
  indexUrl: '../',
  currentVersion: 'v1.0.0',
};

describe('getWidgetScriptTag (pure)', () => {
  it('Test 1: contains marker comment', () => {
    const out = getWidgetScriptTag(opts);
    expect(out).toContain(WIDGET_MARKER);
    expect(out).toContain('<!-- gh-pages-multiplexer:nav-widget -->');
  });

  it('Test 2: is a script element', () => {
    const out = getWidgetScriptTag(opts).trim();
    expect(out.startsWith('<script')).toBe(true);
    expect(out.endsWith('</script>')).toBe(true);
  });

  it('Test 3: inlines opts values', () => {
    const out = getWidgetScriptTag({
      manifestUrl: '../versions.json',
      indexUrl: '../',
      currentVersion: 'v1.2.3',
    });
    expect(out).toContain('../versions.json');
    expect(out).toContain('../');
    expect(out).toContain('v1.2.3');
  });

  it('Test 4: contains custom element name gh-pm-nav', () => {
    const out = getWidgetScriptTag(opts);
    expect(out).toContain('gh-pm-nav');
  });

  it('Test 5: uses Shadow DOM mode open', () => {
    const out = getWidgetScriptTag(opts);
    const hasOpen =
      /mode:\s*['"]open['"]/.test(out);
    expect(hasOpen).toBe(true);
  });

  it('Test 6: IIFE-wrapped, no top-level globals', () => {
    const out = getWidgetScriptTag(opts);
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
    const out = getWidgetScriptTag(opts);
    expect(out).not.toMatch(/\bsrc=/);
    expect(out).not.toMatch(/<link\b/);
    expect(out).not.toMatch(/import\(['"]http/);
    expect(out).not.toMatch(/fetch\(['"]http/);
  });

  it('Test 8: escapes currentVersion to prevent script breakout', () => {
    const evil = "v1'\"</script>";
    const out = getWidgetScriptTag({
      manifestUrl: '../versions.json',
      indexUrl: '../',
      currentVersion: evil,
    });
    // first </script> must be at the very end
    const firstClose = out.indexOf('</script>');
    const lastClose = out.lastIndexOf('</script>');
    expect(firstClose).toBe(lastClose);
    // Raw evil string must not appear
    expect(out).not.toContain(evil);
  });

  it('Test 9: deterministic / pure', () => {
    expect(getWidgetScriptTag(opts)).toBe(getWidgetScriptTag(opts));
  });
});

describe('injectWidgetIntoHtmlFiles (I/O)', () => {
  it('Test 10: basic injection before </body>', async () => {
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><body><h1>hi</h1></body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toBe(1);
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
    expect(n).toBe(3);
    for (const f of ['index.html', 'sub/page.html', 'sub/deeper/three.html']) {
      const c = await readFile(path.join(workdir, f), 'utf8');
      expect(c).toContain(WIDGET_MARKER);
    }
  });

  it('Test 12: idempotency (D-12)', async () => {
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><body>x</body></html>', 'utf8');
    const n1 = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n1).toBe(1);
    const after1 = await readFile(file, 'utf8');
    const n2 = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n2).toBe(0);
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
    expect(n).toBe(1);
    expect(await readFile(file, 'utf8')).toContain(WIDGET_MARKER);
  });

  it('Test 15: missing </body>, fallback to </html> (D-14)', async () => {
    const warnMock = vi.mocked(core.warning);
    const file = path.join(workdir, 'index.html');
    await writeFile(file, '<html><h1>no body close</h1></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toBe(1);
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
    expect(n).toBe(1);
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
    expect(n).toBe(0);
    const calls = infoMock.mock.calls.map((c) => String(c[0])).join('\n');
    expect(/0 HTML|no widget injection/i.test(calls)).toBe(true);
  });

  it('Test 18: errors propagate (D-16)', async () => {
    await expect(
      injectWidgetIntoHtmlFiles(path.join(workdir, 'does-not-exist'), opts),
    ).rejects.toThrow();
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

  it('Test 20: mixed states - already-injected file untouched, fresh file injected', async () => {
    const a = path.join(workdir, 'a.html');
    const b = path.join(workdir, 'b.html');
    const aContent = `<html><body>a${WIDGET_MARKER}</body></html>`;
    await writeFile(a, aContent, 'utf8');
    await writeFile(b, '<html><body>b</body></html>', 'utf8');
    const n = await injectWidgetIntoHtmlFiles(workdir, opts);
    expect(n).toBe(1);
    expect(await readFile(a, 'utf8')).toBe(aContent);
    expect(await readFile(b, 'utf8')).toContain(WIDGET_MARKER);
  });
});
