import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findHtmlFiles, findHtmlFilesRelative, findSlotHtmlFiles, slotPageUrl } from '../src/slot-pages.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'slot-pages-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('findHtmlFiles', () => {
  it('finds every .html file at any depth, case-insensitively, and nothing else', async () => {
    await mkdir(path.join(dir, 'a', 'b'), { recursive: true });
    await mkdir(path.join(dir, 'dir.html'));
    await writeFile(path.join(dir, 'index.html'), '');
    await writeFile(path.join(dir, 'a', 'page.HTML'), '');
    await writeFile(path.join(dir, 'a', 'b', 'deep.html'), '');
    await writeFile(path.join(dir, 'a', 'style.css'), '');
    expect((await findHtmlFiles(dir)).sort()).toEqual(
      [path.join(dir, 'a', 'b', 'deep.html'), path.join(dir, 'a', 'page.HTML'), path.join(dir, 'index.html')].sort(),
    );
  });

  it('fails loudly when the directory does not exist', async () => {
    await expect(findHtmlFiles(path.join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('findSlotHtmlFiles', () => {
  it('reads a slot with no directory as zero pages', async () => {
    expect(await findSlotHtmlFiles(path.join(dir, 'missing'))).toEqual([]);
  });

  it('propagates fs errors other than a missing slot directory', async () => {
    await writeFile(path.join(dir, 'not-a-dir'), '');
    await expect(findSlotHtmlFiles(path.join(dir, 'not-a-dir'))).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});

describe('findHtmlFilesRelative', () => {
  it('lists every page as a sorted, /-separated path relative to the slot', async () => {
    await mkdir(path.join(dir, 'docs', 'api'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '');
    await writeFile(path.join(dir, 'docs', 'index.html'), '');
    await writeFile(path.join(dir, 'docs', 'api', 'users.html'), '');
    expect(await findHtmlFilesRelative(dir)).toEqual(['docs/api/users.html', 'docs/index.html', 'index.html']);
  });
});

describe('slotPageUrl', () => {
  it('joins site base, slot and page path', () => {
    expect(slotPageUrl('https://example.com/repo', 'v1.0.0', 'docs/api.html')).toBe('https://example.com/repo/v1.0.0/docs/api.html');
  });

  it('percent-encodes each segment but keeps the separators', () => {
    expect(slotPageUrl('https://example.com', 'v1 beta', 'my docs/faq#1?.html')).toBe(
      'https://example.com/v1%20beta/my%20docs/faq%231%3F.html',
    );
  });
});
