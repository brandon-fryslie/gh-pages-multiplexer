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
import {
  DEFAULT_WIDGET_ICON,
  DEFAULT_WIDGET_LABEL,
  DEFAULT_WIDGET_POSITION,
  DEFAULT_WIDGET_COLOR,
} from './widget-config.js';

export const WIDGET_MARKER = '<!-- gh-pages-multiplexer:nav-widget -->';

export interface WidgetInjectionOpts {
  /** Relative URL from a deployed page back to the root versions.json (e.g. "../versions.json"). */
  manifestUrl: string;
  /** Relative URL from a deployed page back to the root index (e.g. "../"). */
  indexUrl: string;
  /** The current version slot name; the widget bolds this row and disables click. */
  currentVersion: string;
  /** Custom SVG markup for the handle icon. Empty = built-in layers icon. */
  icon: string;
  /** Label text shown on hover; supports "{version}" token. Empty = "{version}". */
  label: string;
  /** Widget location, format "<edge> <vertical%>". Empty = "right 80%". */
  position: string;
  /** Hex color for handle background. Empty = "#f97316". */
  color: string;
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
  /* Handle colors — intentionally bright and theme-independent so the tab is obvious on any host page.
     --handle-bg is overridden at runtime by the user's --widget-color when set. The hover state
     uses CSS filter rather than a separate color variable, so it works for any base color. */
  --handle-bg: #f97316;
  --handle-fg: #ffffff;
  /* Drawer geometry (single source of truth for the slide math). */
  --panel-width: 240px;
  --handle-width: 44px;
  --peek: 10px;
  /* Position and edge are runtime-configurable. The drawer's center sits on this y-line. */
  --position-y: 80%;
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
  /* The drawer's vertical center sits on --position-y (configurable; default 80%). */
  top: var(--position-y);
  display: flex;
  flex-direction: row;
  align-items: center;
  z-index: 2147483647;
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .drawer { transition: none; }
}
/* [LAW:dataflow-not-control-flow] Edge variant is data: a class on the drawer picks
   the right anchor + transform direction. No JS state-toggling for layout — only the
   class assignment at construction time, then CSS does the rest. */
.drawer.edge-right {
  right: 0;
  transform: translate(var(--panel-width), -50%);
}
.drawer.edge-right:hover:not(.open) {
  transform: translate(calc(var(--panel-width) - var(--peek)), -50%);
}
.drawer.edge-right.open {
  transform: translate(0, -50%);
}
.drawer.edge-left {
  left: 0;
  flex-direction: row-reverse;
  transform: translate(calc(-1 * var(--panel-width)), -50%);
}
.drawer.edge-left:hover:not(.open) {
  transform: translate(calc(-1 * (var(--panel-width) - var(--peek))), -50%);
}
.drawer.edge-left.open {
  transform: translate(0, -50%);
}
.handle {
  width: var(--handle-width);
  background: var(--handle-bg);
  color: var(--handle-fg);
  border: none;
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
  transition: padding 180ms ease-out, filter 180ms ease-out;
}
/* [LAW:single-enforcer] Hover darkening uses CSS filter rather than a separate
   --handle-bg-hover variable so it works for any user-provided color without forcing
   the user to specify two shades. */
.handle:hover { filter: brightness(0.92); }
.handle:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: -4px;
}
/* Right-edge handle: rounded LEFT side (the side facing the viewport). */
.drawer.edge-right .handle {
  border-top-left-radius: 14px;
  border-bottom-left-radius: 14px;
  box-shadow: -4px 0 16px rgba(0,0,0,0.22), inset 1px 0 0 rgba(255,255,255,0.15);
}
/* Left-edge handle: rounded RIGHT side (the side facing the viewport). */
.drawer.edge-left .handle {
  border-top-right-radius: 14px;
  border-bottom-right-radius: 14px;
  box-shadow: 4px 0 16px rgba(0,0,0,0.22), inset -1px 0 0 rgba(255,255,255,0.15);
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
  padding: 12px;
  flex: 0 0 auto;
}
.drawer.edge-right .panel {
  border-right: none;
  box-shadow: -8px 0 24px rgba(0,0,0,0.18);
}
.drawer.edge-left .panel {
  border-left: none;
  box-shadow: 8px 0 24px rgba(0,0,0,0.18);
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
      <span class="icon-slot"></span>
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

  // [LAW:dataflow-not-control-flow] Defaults are resolved here, BEFORE the script
  // template is built. The runtime script never sees empty strings — it always sees
  // a complete configuration. Variability lives in the *value* picked here, not in
  // runtime branches inside the inlined script.
  const iconResolved = opts.icon || DEFAULT_WIDGET_ICON;
  const labelResolved = opts.label || DEFAULT_WIDGET_LABEL;
  const positionResolved = opts.position || DEFAULT_WIDGET_POSITION;
  const colorResolved = opts.color || DEFAULT_WIDGET_COLOR;

  const M = safe(opts.manifestUrl);
  const I = safe(opts.indexUrl);
  const C = safe(opts.currentVersion);
  const ICON = safe(iconResolved);
  const LABEL = safe(labelResolved);
  const POSITION = safe(positionResolved);
  const COLOR = safe(colorResolved);
  const CSS = safe(SHADOW_CSS);
  const HTML = safe(SHADOW_HTML);

  return `<script>${WIDGET_MARKER}
(function(){
  var MANIFEST_URL = ${M};
  var INDEX_URL = ${I};
  var CURRENT = ${C};
  var ICON_SVG = ${ICON};
  var LABEL_TEMPLATE = ${LABEL};
  var POSITION = ${POSITION};
  var COLOR = ${COLOR};
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
        // Inject custom icon SVG into the icon-slot. innerHTML in Shadow DOM does NOT
        // execute scripts, so even malformed SVG is safe to render.
        var iconSlot = root.querySelector('.handle .icon-slot');
        if (iconSlot) { iconSlot.innerHTML = ICON_SVG; }
        // Substitute {version} in the label template, then assign via textContent
        // (no HTML interpretation).
        var verSpan = root.querySelector('.handle .ver');
        var labelText = LABEL_TEMPLATE.split('{version}').join(CURRENT);
        if (verSpan) { verSpan.textContent = labelText; }
        this._handle.setAttribute('aria-label', 'Switch version (current: ' + CURRENT + ')');
        // Apply position: parse "<edge> <vertical%>" and set drawer class + CSS var.
        var posParts = POSITION.trim().split(/\\s+/);
        var edge = (posParts[0] === 'left') ? 'left' : 'right';
        var verticalY = posParts[1] || '80%';
        this._drawer.classList.add('edge-' + edge);
        var rootEl = root.querySelector('.root');
        if (rootEl) {
          rootEl.style.setProperty('--position-y', verticalY);
          if (COLOR) { rootEl.style.setProperty('--handle-bg', COLOR); }
        }
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
