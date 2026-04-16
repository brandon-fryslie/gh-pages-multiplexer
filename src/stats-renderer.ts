// [LAW:one-source-of-truth] The stats page is a pure client-side projection of
//   versions.json. It does not duplicate data; it fetches and renders.
// [LAW:dataflow-not-control-flow] renderStatsHtml returns a deterministic HTML
//   string. Runtime rendering in the browser runs the same JS every time; empty
//   manifest produces an empty-state render.
// [LAW:single-enforcer] All user-controlled interpolation at server-render time
//   MUST go through escapeHtml(). The inline JS escapes user data at runtime too.

import type { RepoMeta } from './index-renderer.js';
import { escapeHtml } from './index-renderer.js';

// Static CSS — no interpolation, safe to inline as a template literal.
const STATS_CSS = `:root { --bg: #ffffff; --bg-card: #fafafa; --fg: #1f2328; --fg-muted: #656d76; --border: #d0d7de; --accent: #0969da; --bar: #2da44e; --bar-pr: #bf8700; }
body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 15px; line-height: 1.5; margin: 0; }
main { max-width: 920px; margin: 0 auto; padding: 24px 16px; }
h1 { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
h2 { font-size: 18px; font-weight: 600; margin: 24px 0 12px; }
.subtitle { color: var(--fg-muted); margin: 0 0 24px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
.stats-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.stat { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; flex: 1 1 140px; }
.stat-label { color: var(--fg-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
.bar-row { display: grid; grid-template-columns: 120px 1fr 48px; gap: 10px; align-items: center; margin-bottom: 4px; font-size: 13px; }
.bar-label { color: var(--fg-muted); text-align: right; font-variant-numeric: tabular-nums; }
.bar-track { height: 14px; background: #e7e9ec; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--bar); }
.bar-fill.pr { background: var(--bar-pr); }
.bar-value { font-variant-numeric: tabular-nums; color: var(--fg-muted); }
.authors { display: flex; flex-direction: column; gap: 6px; }
.author-row { display: grid; grid-template-columns: 1fr 48px; gap: 10px; align-items: center; font-size: 13px; }
.mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
.empty { text-align: center; color: var(--fg-muted); padding: 32px; }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--fg-muted); font-size: 13px; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --bg-card: #161b22; --fg: #e6edf3; --fg-muted: #8d96a0; --border: #30363d; --accent: #2f81f7; --bar: #2f6f46; --bar-pr: #a66f00; } .bar-track { background: #30363d; } }
@media (max-width: 600px) { main { padding: 16px 12px; } .bar-row { grid-template-columns: 90px 1fr 44px; } }`;

// Client-side script — data-driven, no DOM branches that skip rendering.
// Uses native fetch + DOM; zero dependencies. All user-controlled data is escaped
// via setting .textContent (not innerHTML) at render time.
const STATS_SCRIPT = `
(function(){
  'use strict';
  function pad(n){ return String(n).padStart(2,'0'); }
  function weekKey(iso){
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return 'unknown';
    // ISO week start (Monday)
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate());
  }
  function setText(id, v){
    var el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }
  function renderBars(container, rows, totalMax, pr){
    container.textContent = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = document.createElement('div'); row.className = 'bar-row';
      var label = document.createElement('span'); label.className = 'bar-label mono';
      label.textContent = r.label;
      var track = document.createElement('div'); track.className = 'bar-track';
      var fill = document.createElement('div'); fill.className = 'bar-fill' + (pr ? ' pr' : '');
      fill.style.width = (totalMax > 0 ? (r.value / totalMax * 100) : 0) + '%';
      track.appendChild(fill);
      var value = document.createElement('span'); value.className = 'bar-value';
      value.textContent = String(r.value);
      row.appendChild(label); row.appendChild(track); row.appendChild(value);
      container.appendChild(row);
    }
  }
  fetch('../versions.json', { cache: 'no-store' }).then(function(r){
    if (!r.ok) throw new Error('versions.json fetch failed: ' + r.status);
    return r.json();
  }).then(function(manifest){
    var versions = (manifest && manifest.versions) || [];
    var prRe = /^pr-\\d+$/;

    var total = versions.length;
    var prCount = 0, tagCount = 0, branchCount = 0;
    var byWeek = {};
    var byAuthor = {};

    for (var i = 0; i < versions.length; i++) {
      var v = versions[i];
      var isPr = prRe.test(v.version);
      if (isPr) prCount++;
      else if (/^refs\\/tags\\//.test(v.ref || '')) tagCount++;
      else branchCount++;

      var wk = weekKey(v.timestamp);
      byWeek[wk] = byWeek[wk] || { total: 0, pr: 0 };
      byWeek[wk].total++;
      if (isPr) byWeek[wk].pr++;

      var commits = v.commits || [];
      for (var j = 0; j < commits.length; j++) {
        var name = commits[j].author_name || 'unknown';
        byAuthor[name] = (byAuthor[name] || 0) + 1;
      }
    }

    setText('stat-total', total);
    setText('stat-tags', tagCount);
    setText('stat-branches', branchCount);
    setText('stat-prs', prCount);

    if (total === 0) {
      var empty = document.getElementById('empty-state');
      if (empty) empty.style.display = 'block';
      var cards = document.getElementById('charts');
      if (cards) cards.style.display = 'none';
      return;
    }

    // Weekly deploy chart — last 12 weeks.
    var weeks = Object.keys(byWeek).sort().slice(-12);
    var weekMax = 0;
    for (var k = 0; k < weeks.length; k++) {
      if (byWeek[weeks[k]].total > weekMax) weekMax = byWeek[weeks[k]].total;
    }
    var weekRows = weeks.map(function(w){
      return { label: w, value: byWeek[w].total };
    });
    renderBars(document.getElementById('chart-weeks'), weekRows, weekMax, false);

    // Top contributors — sorted by commit count, top 10.
    var authors = Object.keys(byAuthor)
      .map(function(n){ return { name: n, count: byAuthor[n] }; })
      .sort(function(a, b){ return b.count - a.count; })
      .slice(0, 10);
    var authorMax = authors.length > 0 ? authors[0].count : 0;
    var authorRows = authors.map(function(a){ return { label: a.name, value: a.count }; });
    renderBars(document.getElementById('chart-authors'), authorRows, authorMax, false);

    setText('generated-at', manifest.generated_at || new Date().toISOString());
  }).catch(function(err){
    var banner = document.getElementById('error-banner');
    if (banner) {
      banner.textContent = 'Failed to load stats: ' + err.message;
      banner.style.display = 'block';
    }
  });
})();
`;

export function renderStatsHtml(repoMeta: RepoMeta): string {
  const title = `${repoMeta.owner}/${repoMeta.repo} — Deploy Stats`;
  const heading = `${repoMeta.owner}/${repoMeta.repo}`;
  const repoUrl = `https://github.com/${escapeHtml(repoMeta.owner)}/${escapeHtml(repoMeta.repo)}`;
  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${STATS_CSS}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<main>\n` +
    `<header>\n` +
    `<h1><a href="${repoUrl}" title="View on GitHub">${escapeHtml(heading)}</a></h1>\n` +
    `<p class="subtitle">Deploy stats \u00b7 <a href="./">\u2190 Versions</a></p>\n` +
    `</header>\n` +
    `<div id="error-banner" class="card" style="display:none;color:#b91c1c;"></div>\n` +
    `<section class="stats-row">\n` +
    `  <div class="stat"><div class="stat-label">Total deploys</div><div class="stat-value" id="stat-total">—</div></div>\n` +
    `  <div class="stat"><div class="stat-label">Tags</div><div class="stat-value" id="stat-tags">—</div></div>\n` +
    `  <div class="stat"><div class="stat-label">Branches</div><div class="stat-value" id="stat-branches">—</div></div>\n` +
    `  <div class="stat"><div class="stat-label">PR previews</div><div class="stat-value" id="stat-prs">—</div></div>\n` +
    `</section>\n` +
    `<div id="charts">\n` +
    `<section class="card">\n` +
    `<h2>Deploys per week (last 12)</h2>\n` +
    `<div id="chart-weeks"></div>\n` +
    `</section>\n` +
    `<section class="card">\n` +
    `<h2>Top contributors</h2>\n` +
    `<div id="chart-authors"></div>\n` +
    `</section>\n` +
    `</div>\n` +
    `<div id="empty-state" class="card empty" style="display:none;">\n` +
    `<p>No deployments yet \u2014 stats will appear after the first deploy.</p>\n` +
    `</div>\n` +
    `<footer>Generated by gh-pages-multiplexer \u00b7 <span id="generated-at"></span></footer>\n` +
    `</main>\n` +
    `<script>${STATS_SCRIPT}</script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
