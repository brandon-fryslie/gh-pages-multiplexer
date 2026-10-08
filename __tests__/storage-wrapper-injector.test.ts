import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { placeStorageWrapperInSlot } from '../src/storage-wrapper-injector.js';
import { STORAGE_WRAPPER_MARKER, renderStorageWrapperScriptTag } from '../src/storage-wrapper.js';

let dir: string;
const opts = { namespace: 'gh-pm:o/r/v1:' };
const tag = renderStorageWrapperScriptTag(opts);
const page = (head: string): string => `<html><head>${head}<title>t</title></head><body></body></html>`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sw-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('placeStorageWrapperInSlot', () => {
  it('every-page: inserts the wrapper into every HTML file', async () => {
    await writeFile(path.join(dir, 'index.html'), page(''));
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await writeFile(path.join(dir, 'docs', 'api.html'), page(''));

    expect(await placeStorageWrapperInSlot(dir, opts, 'every-page')).toEqual({ inserted: 2, refreshed: 0, current: 0 });
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toBe(page(tag));
    expect(await readFile(path.join(dir, 'docs', 'api.html'), 'utf8')).toBe(page(tag));
  });

  it('every-page: placing twice leaves the file byte-identical and counts it current', async () => {
    await writeFile(path.join(dir, 'index.html'), page(''));
    await placeStorageWrapperInSlot(dir, opts, 'every-page');
    expect(await placeStorageWrapperInSlot(dir, opts, 'every-page')).toEqual({ inserted: 0, refreshed: 0, current: 1 });
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toBe(page(tag));
  });

  it('wrapped-pages: re-renders a stale wrapper block and leaves a page without one untouched', async () => {
    const stale = `${STORAGE_WRAPPER_MARKER}<script>var OLD_WRAPPER;</script>`;
    await writeFile(path.join(dir, 'wrapped.html'), page(stale));
    await writeFile(path.join(dir, 'plain.html'), page(''));

    expect(await placeStorageWrapperInSlot(dir, opts, 'wrapped-pages')).toEqual({ inserted: 0, refreshed: 1, current: 0 });
    expect(await readFile(path.join(dir, 'wrapped.html'), 'utf8')).toBe(page(tag));
    expect(await readFile(path.join(dir, 'plain.html'), 'utf8')).toBe(page(''));
  });

  it('inserts at the very start of <head>, before any user script', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><head><script>console.log(localStorage.foo)</script></head><body></body></html>');
    await placeStorageWrapperInSlot(dir, opts, 'every-page');
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toBe(
      `<html><head>${tag}<script>console.log(localStorage.foo)</script></head><body></body></html>`,
    );
  });

  it('wraps a document with no <head> in one', async () => {
    await writeFile(path.join(dir, 'index.html'), '<html><body>hi</body></html>');
    await placeStorageWrapperInSlot(dir, opts, 'every-page');
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toBe(`<head>${tag}</head><html><body>hi</body></html>`);
  });

  it('a slot with no HTML files, or no directory, has zero pages', async () => {
    await writeFile(path.join(dir, 'not-html.txt'), 'x');
    const none = { inserted: 0, refreshed: 0, current: 0 };
    expect(await placeStorageWrapperInSlot(dir, opts, 'every-page')).toEqual(none);
    expect(await placeStorageWrapperInSlot(path.join(dir, 'missing'), opts, 'every-page')).toEqual(none);
  });

  it('fails loudly on a wrapper block with no closing </script>', async () => {
    await writeFile(path.join(dir, 'index.html'), page(`${STORAGE_WRAPPER_MARKER}<script>var CUT_OFF;`));
    await expect(placeStorageWrapperInSlot(dir, opts, 'wrapped-pages')).rejects.toThrow(/has no closing <\/script>/);
  });
});
