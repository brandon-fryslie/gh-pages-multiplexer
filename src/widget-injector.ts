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
  /* Handle colors — intentionally bright and theme-independent so the tab is obvious on any host page. */
  --handle-bg: #f97316;
  --handle-bg-hover: #ea580c;
  --handle-fg: #ffffff;
  /* Drawer geometry (single source of truth for the slide math). */
  --panel-width: 240px;
  --handle-width: 44px;
  --peek: 10px;
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
.drawer {
  position: fixed;
  /* Anchored to the lower-right (~4/5 down the viewport) where there is typically no
     critical host-page content. Using bottom: rather than top: 50% so the handle
     position is stable across viewport heights. */
  bottom: 18%;
  right: 0;
  display: flex;
  flex-direction: row;
  /* align-items: flex-end lets the handle shrink-wrap its content and aligns both the
     handle and panel to the bottom of the drawer — so the handle's visual position
     is the same whether the panel is open or closed. */
  align-items: flex-end;
  z-index: 2147483647;
  /* [LAW:dataflow-not-control-flow] The drawer is ALWAYS in the DOM, ALWAYS transitions.
     State (closed / peek / open) is encoded in transform values only. */
  transform: translateX(var(--panel-width));
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}
.drawer:hover:not(.open) {
  transform: translateX(calc(var(--panel-width) - var(--peek)));
}
.drawer.open {
  transform: translateX(0);
}
@media (prefers-reduced-motion: reduce) {
  .drawer { transition: none; }
}
.handle {
  width: var(--handle-width);
  background: var(--handle-bg);
  color: var(--handle-fg);
  border: none;
  border-top-left-radius: 14px;
  border-bottom-left-radius: 14px;
  box-shadow: -4px 0 16px rgba(0,0,0,0.22), inset 1px 0 0 rgba(255,255,255,0.15);
  cursor: pointer;
  /* Padding is content-driven; the icon and label have their own transitions and the
     handle shrink-wraps to match (no min-height). */
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.01em;
  flex: 0 0 auto;
  transition: padding 180ms ease-out;
}
.handle:hover { background: var(--handle-bg-hover); }
.handle:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: -4px;
}
/* [LAW:dataflow-not-control-flow] Closed state shows a small icon only. Hover or open
   state expands the icon and reveals the label. The CSS always applies, the difference
   is data — the .open class and the :hover pseudo. No JS state-toggling for these. */
.handle svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: block;
  transition: width 180ms ease-out, height 180ms ease-out;
}
.drawer:hover .handle svg,
.drawer.open .handle svg {
  width: 22px;
  height: 22px;
}
.handle .ver {
  font-size: 11px;
  line-height: 1.15;
  max-width: 40px;
  max-height: 0;
  margin-top: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  text-align: center;
  transition: max-height 180ms ease-out, opacity 180ms ease-out, margin-top 180ms ease-out;
}
.drawer:hover .handle .ver,
.drawer.open .handle .ver {
  max-height: 16px;
  margin-top: 6px;
  opacity: 1;
}
.panel {
  width: var(--panel-width);
  max-height: 60vh;
  overflow-y: auto;
  background: var(--widget-bg);
  color: var(--widget-fg);
  border: 1px solid var(--widget-border);
  border-right: none;
  padding: 12px;
  box-shadow: -8px 0 24px rgba(0,0,0,0.18);
  flex: 0 0 auto;
}
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
  .root { --panel-width: calc(100vw - 72px); }
}
`;

const SHADOW_HTML = `
<div class="root">
  <div class="drawer" role="region" aria-label="Version switcher">
    <button class="handle" type="button" aria-expanded="false" aria-controls="gh-pm-nav-panel" aria-label="Switch version">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
        <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>
        <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>
      </svg>
      <span class="ver"></span>
    </button>
    <div class="panel" id="gh-pm-nav-panel" role="dialog" aria-label="Versions">
      <h2>Versions</h2>
      <a class="index-link" href="">\u2190 Index</a>
      <div class="rows"><div class="state">Loading versions\u2026</div></div>
    </div>
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
        this._drawer = root.querySelector('.drawer');
        this._handle = root.querySelector('.handle');
        this._panel = root.querySelector('.panel');
        this._rows = root.querySelector('.rows');
        this._indexLink = root.querySelector('.index-link');
        this._indexLink.setAttribute('href', INDEX_URL);
        // Display current version name on the handle tab (self-describing).
        // textContent = safe DOM assignment, no HTML interpretation.
        var verSpan = root.querySelector('.handle .ver');
        if (verSpan) { verSpan.textContent = CURRENT; }
        this._handle.setAttribute('aria-label', 'Switch version (current: ' + CURRENT + ')');
        this._onDocClick = this._onDocClick.bind(this);
        this._onKey = this._onKey.bind(this);
        this._handle.addEventListener('click', this._toggle.bind(this));
      }
      _toggle(){
        this._open ? this._close() : this._open_();
      }
      _open_(){
        this._open = true;
        this._drawer.classList.add('open');
        this._handle.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', this._onDocClick, true);
        document.addEventListener('keydown', this._onKey, true);
        if (!this._loaded) { this._fetch(); }
        var first = this._panel.querySelector('a, button, [tabindex]');
        if (first) first.focus();
      }
      _close(){
        this._open = false;
        this._drawer.classList.remove('open');
        this._handle.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', this._onDocClick, true);
        document.removeEventListener('keydown', this._onKey, true);
        this._handle.focus();
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
