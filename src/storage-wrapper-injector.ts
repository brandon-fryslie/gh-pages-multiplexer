// [LAW:single-enforcer] This module is the only place that injects the storage
//   wrapper script tag into HTML files.
// [LAW:dataflow-not-control-flow] Walks html files unconditionally. An "enabled"
//   flag of false produces zero mutations (returns 0); empty directory also
//   returns 0. Same data shape either way.
// [LAW:no-defensive-null-guards] fs errors propagate; we do not swallow failures.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import {
  STORAGE_WRAPPER_MARKER,
  renderStorageWrapperScriptTag,
  type StorageWrapperOpts,
} from './storage-wrapper.js';

async function findHtmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/**
 * Insert tag as the first child of <head>, or before </head> if no opening tag
 * is found, or wrap the document in a minimal <head> for pathological HTML.
 * [LAW:dataflow-not-control-flow] Three data-driven positions, one insertion op.
 */
function insertAtHeadStart(html: string, tag: string): string {
  const headOpen = html.search(/<head[^>]*>/i);
  if (headOpen !== -1) {
    const end = html.indexOf('>', headOpen) + 1;
    return html.slice(0, end) + tag + html.slice(end);
  }
  const headClose = html.toLowerCase().lastIndexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + tag + html.slice(headClose);
  }
  return `<head>${tag}</head>` + html;
}

/**
 * Walk `versionDir` recursively and inject the storage-wrapper script into
 * every *.html file. Idempotent: files already containing the marker are left
 * byte-identical.
 *
 * Returns the count of files newly injected. Zero when the walk finds no HTML,
 * or when `opts` is undefined (a "disabled" data value, not a guarded skip).
 */
export async function injectStorageWrapperIntoDir(
  versionDir: string,
  opts: StorageWrapperOpts | undefined,
): Promise<number> {
  if (!opts) return 0;  // disabled-as-data: no files to walk for this deploy
  const tag = renderStorageWrapperScriptTag(opts);
  const htmlFiles = await findHtmlFiles(versionDir);
  if (htmlFiles.length === 0) {
    core.info(`0 HTML files in ${versionDir}, no storage-wrapper injection needed`);
    return 0;
  }
  let count = 0;
  for (const file of htmlFiles) {
    const original = await readFile(file, 'utf8');
    if (original.includes(STORAGE_WRAPPER_MARKER)) continue;
    const next = insertAtHeadStart(original, tag);
    await writeFile(file, next, 'utf8');
    count++;
  }
  return count;
}
