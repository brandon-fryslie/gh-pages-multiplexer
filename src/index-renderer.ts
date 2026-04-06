// [LAW:one-source-of-truth] versions.json is the sole source of version data;
// this module is a pure projection of it to HTML. No second representation.
// [LAW:dataflow-not-control-flow] Same operations run every call. Empty manifest
// and missing commits[] are encoded in the data path (array iteration over [],
// nullish coalescing to []) — never in conditional skips of operations.
// [LAW:single-enforcer] All user-controlled string interpolation MUST go through
// escapeHtml(). No raw ${userData} is permitted anywhere in the rendered output.

import type { Manifest, ManifestEntry, CommitInfo } from './types.js';

export interface RepoMeta {
  owner: string;
  repo: string;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// [LAW:dataflow-not-control-flow] pure; Invalid Date flows as data fallback (raw string)
// rather than a thrown exception that would skip downstream work.
function formatUtc(iso: string): string {
  const d = new Date(iso);
  const t = d.getTime();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const valid = Number.isFinite(t);
  return valid
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
    : iso;
}

// Static CSS literal. No user data interpolated. [T-03-07 mitigation]
const INLINE_STYLE = `:root { --bg: #ffffff; --bg-card: #fafafa; --fg: #1f2328; --fg-muted: #656d76; --border: #d0d7de; --accent: #0969da; --accent-hover: #0550ae; }
body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 15px; line-height: 1.5; margin: 0; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px; }
h1 { font-size: 28px; font-weight: 600; line-height: 1.25; margin: 0 0 4px; }
h2 { font-size: 20px; font-weight: 600; line-height: 1.25; margin: 0; }
.subtitle { color: var(--fg-muted); margin: 0 0 24px; }
.versions { display: flex; flex-direction: column; gap: 16px; }
.version { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; }
.version-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.timestamp { color: var(--fg-muted); font-size: 13px; }
.meta { color: var(--fg-muted); font-size: 13px; margin: 8px 0 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 13px; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
details { margin-top: 12px; }
summary { cursor: pointer; color: var(--fg-muted); font-size: 13px; }
.commits { list-style: none; padding: 12px 0 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.commits li { font-size: 13px; }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--fg-muted); font-size: 13px; }
.empty { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; text-align: center; color: var(--fg-muted); }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --bg-card: #161b22; --fg: #e6edf3; --fg-muted: #8d96a0; --border: #30363d; --accent: #2f81f7; --accent-hover: #539bf5; } }
@media (max-width: 600px) { main { padding: 16px 12px; } h1 { font-size: 22px; } h2 { font-size: 18px; } .version { padding: 16px 16px; } .version-head { flex-direction: column; align-items: flex-start; gap: 4px; } }`;

function renderCommitRow(c: CommitInfo): string {
  // [LAW:single-enforcer] escapeHtml wraps every user-controlled interpolation.
  const shortSha = c.sha.slice(0, 7);
  const subject = c.message.split('\n')[0];
  return (
    `<li><span class="mono">${escapeHtml(shortSha)}</span> ${escapeHtml(subject)} ` +
    `<span class="muted">\u2014 ${escapeHtml(c.author_name)}</span></li>`
  );
}

function renderCommitDetailsBlock(commits: CommitInfo[]): string {
  // [LAW:dataflow-not-control-flow] data-driven: empty array collapses to empty string.
  const word = commits.length === 1 ? 'commit' : 'commits';
  const rows = commits.map(renderCommitRow).join('');
  return commits.length === 0
    ? ''
    : `<details><summary>${commits.length} ${word}</summary><ul class="commits">${rows}</ul></details>`;
}

function renderVersionCard(entry: ManifestEntry, repoMeta: RepoMeta): string {
  // [LAW:single-enforcer] all user-controlled fields escaped at interpolation.
  const commits: CommitInfo[] = entry.commits ?? [];
  const shortSha = entry.sha.slice(0, 7);
  const ownerE = escapeHtml(repoMeta.owner);
  const repoE = escapeHtml(repoMeta.repo);
  const commitUrl = `https://github.com/${ownerE}/${repoE}/commit/${escapeHtml(entry.sha)}`;
  const viewUrl = `./${escapeHtml(entry.version)}/`;
  const displayTime = formatUtc(entry.timestamp);
  return (
    `<article class="version">` +
    `<div class="version-head">` +
    `<h2>${escapeHtml(entry.version)}</h2>` +
    `<time class="timestamp" datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(displayTime)}</time>` +
    `</div>` +
    `<p class="meta">` +
    `<span class="mono">${escapeHtml(entry.ref)}</span>` +
    `<span>\u00b7</span>` +
    `<a class="mono" href="${commitUrl}">${escapeHtml(shortSha)}</a>` +
    `<span>\u00b7</span>` +
    `<a href="${viewUrl}">View \u2192</a>` +
    `</p>` +
    renderCommitDetailsBlock(commits) +
    `</article>`
  );
}

function renderEmptyState(): string {
  return `<article class="empty"><h2>No versions deployed yet</h2><p>Deploy a version to see it here.</p></article>`;
}

export function renderIndexHtml(manifest: Manifest, repoMeta: RepoMeta): string {
  const count = manifest.versions.length;
  const versionWord = count === 1 ? 'version' : 'versions';
  const subtitleText =
    count === 0 ? 'No versions deployed yet' : `${count} ${versionWord} deployed`;
  const title = `${repoMeta.owner}/${repoMeta.repo} \u2014 Deployed Versions`;
  const headingText = `${repoMeta.owner}/${repoMeta.repo}`;
  const repoUrl = `https://github.com/${escapeHtml(repoMeta.owner)}/${escapeHtml(repoMeta.repo)}`;
  // [LAW:dataflow-not-control-flow] Purity: freshness signal is derived from manifest,
  // not wall clock. Empty manifest -> empty string. [Rule 1 carried from 03-01]
  const generatedAt = count === 0 ? '' : manifest.versions[0].timestamp;

  const bodyContent =
    count === 0
      ? renderEmptyState()
      : manifest.versions.map((e) => renderVersionCard(e, repoMeta)).join('');

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${INLINE_STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<main>\n` +
    `<header>\n` +
    `<h1><a href="${repoUrl}" title="View on GitHub">${escapeHtml(headingText)}</a></h1>\n` +
    `<p class="subtitle">${escapeHtml(subtitleText)}</p>\n` +
    `</header>\n` +
    `<section class="versions">${bodyContent}</section>\n` +
    `<footer>Generated by gh-pages-multiplexer \u00b7 ${escapeHtml(generatedAt)}</footer>\n` +
    `</main>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
