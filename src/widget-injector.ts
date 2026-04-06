// [LAW:one-source-of-truth] WIDGET_MARKER is the sole identifier for "this file already has the widget."
//   The marker is part of the script template, so generation and detection share one constant.
// [LAW:single-enforcer] This module is the only place that knows the widget script template,
//   the marker, and the html-injection rules. branch-manager.ts only calls the exported functions.
// [LAW:dataflow-not-control-flow] injectWidgetIntoHtmlFiles always runs the same walk + per-file
//   pipeline. Empty html list returns 0 from data (the array is empty), not from a guarded skip.
//   The </body> / </html> / append fallback is data-driven *position* selection -- every html file
//   gets exactly one insertion call. The idempotency gate is a data-driven content selection
//   (already-injected => content unchanged), not a guarded skip of the operation.
// [LAW:no-defensive-null-guards] fs errors propagate; no try/catch swallows. No || true.

import * as core from '@actions/core';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export const WIDGET_MARKER = '<!-- gh-pages-multiplexer:nav-widget -->';

export interface WidgetInjectionOpts {
  /** Relative URL from a deployed page back to the root versions.json (e.g. "../versions.json"). */
  manifestUrl: string;
  /** Relative URL from a deployed page back to the root index (e.g. "../"). */
  indexUrl: string;
  /** The current version slot name; the widget bolds this row and disables click. */
  currentVersion: string;
}

// ---- Shadow DOM static assets (UI-SPEC Pillars 1-6) -------------------------

const SHADOW_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.root {
  --widget-bg: #ffffff;
  --widget-bg-hover: #f6f8fa;
  --widget-fg: #1f2328;
  --widget-fg-muted: #656d76;
  --widget-border: #d0d7de;
  --widget-accent: #0969da;
  --widget-accent-hover: #0550ae;
  --widget-current-bg: #ddf4ff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--widget-fg);
}
@media (prefers-color-scheme: dark) {
  .root {
    --widget-bg: #161b22;
    --widget-bg-hover: #21262d;
    --widget-fg: #e6edf3;
    --widget-fg-muted: #8d96a0;
    --widget-border: #30363d;
    --widget-accent: #2f81f7;
    --widget-accent-hover: #539bf5;
    --widget-current-bg: #0c2d6b;
  }
}
.btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--widget-bg);
  color: var(--widget-fg);
  border: 1px solid var(--widget-border);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 2147483647;
}
.btn:focus-visible { outline: 2px solid var(--widget-accent); outline-offset: 2px; }
.btn svg { width: 18px; height: 18px; }
.panel {
  position: fixed;
  bottom: 64px;
  right: 16px;
  width: 240px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--widget-bg);
  color: var(--widget-fg);
  border: 1px solid var(--widget-border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 120ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
  z-index: 2147483647;
}
.panel.open { opacity: 1; transform: translateY(0); pointer-events: auto; }
.panel h2 { font-size: 13px; margin: 0 0 8px 0; font-weight: 600; }
.index-link {
  display: block;
  padding: 8px 12px;
  color: var(--widget-accent);
  text-decoration: none;
  border-radius: 6px;
  margin-bottom: 4px;
}
.index-link:hover { background: var(--widget-bg-hover); }
.index-link:focus-visible { outline: 2px solid var(--widget-accent); outline-offset: 2px; }
.rows { display: flex; flex-direction: column; gap: 2px; }
.row {
  display: block;
  padding: 8px 12px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--widget-fg);
}
.row:hover { background: var(--widget-bg-hover); }
.row:focus-visible { outline: 2px solid var(--widget-accent); outline-offset: 2px; }
.row .ver { font-weight: 600; }
.row.current { background: var(--widget-current-bg); cursor: default; }
.row .ref { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: var(--widget-fg-muted); }
.badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--widget-accent);
  color: #fff;
  margin-left: 6px;
  vertical-align: middle;
}
.state { padding: 8px 12px; color: var(--widget-fg-muted); }
@media (max-width: 600px) {
  .panel { width: calc(100vw - 32px); right: 16px; }
}
`;

const SHADOW_HTML = `
<div class="root">
  <button class="btn" type="button" aria-label="Switch version" aria-expanded="false" aria-controls="gh-pm-nav-panel">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="4" y1="7" x2="20" y2="7"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <line x1="4" y1="17" x2="20" y2="17"/>
    </svg>
  </button>
  <div class="panel" id="gh-pm-nav-panel" role="dialog" aria-label="Versions">
    <h2>Versions</h2>
    <a class="index-link" href="">\u2190 Index</a>
    <div class="rows"><div class="state">Loading versions\u2026</div></div>
  </div>
</div>
`;

/**
 * Pure: returns the full <script>...</script> HTML string with values inlined.
 *
 * Security: opts fields are passed through JSON.stringify to neutralize any
 * `</script>` or quote-character breakout attempts (T-04-01).
 *
 * Structure: IIFE-wrapped, no globals (UI-SPEC verification gate, T-04-08).
 */
export function getWidgetScriptTag(opts: WidgetInjectionOpts): string {
  // [LAW:single-enforcer] JSON.stringify is the sole escape mechanism.
  // JSON.stringify escapes quotes/backslashes but NOT `</`. We additionally
  // replace `</` with `<\/` so an attacker-controlled value containing
  // `</script>` cannot break out of the script element (T-04-01).
  const safe = (v: string): string => JSON.stringify(v).replace(/<\//g, '<\\/');
  const M = safe(opts.manifestUrl);
  const I = safe(opts.indexUrl);
  const C = safe(opts.currentVersion);
  const CSS = safe(SHADOW_CSS);
  const HTML = safe(SHADOW_HTML);

  return `<script>${WIDGET_MARKER}
(function(){
  var MANIFEST_URL = ${M};
  var INDEX_URL = ${I};
  var CURRENT = ${C};
  var SHADOW_CSS = ${CSS};
  var SHADOW_HTML = ${HTML};
  if (customElements.get('gh-pm-nav')) return;
  var GhPmNav = function(){};
  GhPmNav.prototype = Object.create(HTMLElement.prototype);
  function defineEl(){
    class GhPmNav extends HTMLElement {
      constructor(){
        super();
        var root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>' + SHADOW_CSS + '</style>' + SHADOW_HTML;
        this._root = root;
        this._open = false;
        this._loaded = false;
        this._versions = null;
        this._error = null;
        this._btn = root.querySelector('.btn');
        this._panel = root.querySelector('.panel');
        this._rows = root.querySelector('.rows');
        this._indexLink = root.querySelector('.index-link');
        this._indexLink.setAttribute('href', INDEX_URL);
        this._onDocClick = this._onDocClick.bind(this);
        this._onKey = this._onKey.bind(this);
        this._btn.addEventListener('click', this._toggle.bind(this));
      }
      _toggle(){
        this._open ? this._close() : this._open_();
      }
      _open_(){
        this._open = true;
        this._panel.classList.add('open');
        this._btn.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', this._onDocClick, true);
        document.addEventListener('keydown', this._onKey, true);
        if (!this._loaded) { this._fetch(); }
        var first = this._panel.querySelector('a, button, [tabindex]');
        if (first) first.focus();
      }
      _close(){
        this._open = false;
        this._panel.classList.remove('open');
        this._btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', this._onDocClick, true);
        document.removeEventListener('keydown', this._onKey, true);
        this._btn.focus();
      }
      _onDocClick(e){
        var path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(this) === -1) { this._close(); }
      }
      _onKey(e){
        if (e.key === 'Escape') { this._close(); }
      }
      _fetch(){
        var self = this;
        fetch(MANIFEST_URL).then(function(r){
          if (!r.ok) throw new Error('manifest http ' + r.status);
          return r.json();
        }).then(function(data){
          self._loaded = true;
          self._versions = (data && data.versions) || [];
          self._render();
        }).catch(function(err){
          self._loaded = true;
          self._error = err;
          self._render();
        });
      }
      _render(){
        if (this._error) {
          this._rows.innerHTML = '<div class="state">Could not load versions</div>';
          return;
        }
        var versions = this._versions || [];
        var html = '';
        for (var i = 0; i < versions.length; i++) {
          var v = versions[i];
          var name = String(v.version || '');
          var ref = String(v.ref || '');
          var isCurrent = (name === CURRENT);
          var safeName = name.replace(/[&<>"']/g, function(c){
            return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
          });
          var safeRef = ref.replace(/[&<>"']/g, function(c){
            return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
          });
          if (isCurrent) {
            html += '<div class="row current"><span class="ver">' + safeName + '</span><span class="badge">current</span><div class="ref">' + safeRef + '</div></div>';
          } else {
            html += '<a class="row" href="../' + encodeURIComponent(name) + '/"><span class="ver">' + safeName + '</span><div class="ref">' + safeRef + '</div></a>';
          }
        }
        if (!html) { html = '<div class="state">No versions</div>'; }
        this._rows.innerHTML = html;
      }
    }
    customElements.define('gh-pm-nav', GhPmNav);
  }
  defineEl();
  var el = document.createElement('gh-pm-nav');
  (document.body || document.documentElement).appendChild(el);
})();
</script>`;
}

// ---- Recursive walk ---------------------------------------------------------

async function findHtmlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findHtmlFiles(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// ---- Insertion (data-driven position selection, D-14) ----------------------

function insertScript(html: string, scriptTag: string, filePath: string): string {
  // [LAW:dataflow-not-control-flow] All three branches emit `original + scriptTag`.
  // The *position* varies by data (which closing tag is present); the operation does not.
  const bodyIdx = html.lastIndexOf('</body>');
  if (bodyIdx !== -1) {
    return html.slice(0, bodyIdx) + scriptTag + html.slice(bodyIdx);
  }
  const htmlIdx = html.lastIndexOf('</html>');
  if (htmlIdx !== -1) {
    return html.slice(0, htmlIdx) + scriptTag + html.slice(htmlIdx);
  }
  // Malformed HTML: no </body> AND no </html>. Append + warn (D-14, T-04-04).
  core.warning(
    `Malformed HTML in ${filePath}: no </body> or </html>; appending widget at end of file`,
  );
  return html + scriptTag;
}

/**
 * Walks versionDir recursively, injects the widget script tag into every *.html file.
 * Returns the count of files newly injected (already-injected files contribute 0).
 *
 * Idempotent (D-12): files already containing WIDGET_MARKER are byte-identical after.
 * Non-html files are never touched (D-13).
 * Zero-html case is a no-op success with an info log (D-17).
 * fs errors propagate -- no swallowed catches (D-16).
 */
export async function injectWidgetIntoHtmlFiles(
  versionDir: string,
  opts: WidgetInjectionOpts,
): Promise<number> {
  const scriptTag = getWidgetScriptTag(opts);
  const htmlFiles = await findHtmlFiles(versionDir);

  if (htmlFiles.length === 0) {
    // [LAW:dataflow-not-control-flow] Data-driven no-op (D-17): empty list -> 0,
    // not a guarded skip. The info log is the documented happy-path observable.
    core.info(`0 HTML files in ${versionDir}, no widget injection needed`);
    return 0;
  }

  let count = 0;
  for (const file of htmlFiles) {
    const original = await readFile(file, 'utf8');
    const alreadyInjected = original.includes(WIDGET_MARKER);
    // Data-driven content selection: marked -> unchanged; unmarked -> inserted.
    const injected = alreadyInjected ? original : insertScript(original, scriptTag, file);
    if (!alreadyInjected) {
      await writeFile(file, injected, 'utf8');
      count++;
    }
  }
  return count;
}
