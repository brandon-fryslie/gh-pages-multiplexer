# Phase 4: Navigation Widget - Context

**Gathered:** 2026-04-06 (assumptions mode, --auto)
**Status:** Ready for planning

<domain>
## Phase Boundary

A small floating UI widget injected into every HTML file inside every deployed version subdirectory. The widget runtime-fetches `versions.json` from the gh-pages root and renders a version switcher + link back to the index. Uses Shadow DOM for style isolation. Injection happens at deploy time. Out of scope: same-page cross-version navigation (NAVE-01, v2), outdated-version banner (NAVE-02, v2).
</domain>

<decisions>
## Implementation Decisions

### Generation strategy
- **D-01:** Build the widget as a single self-contained `<script>` tag inserted into every HTML file in the version subdirectory at deploy time. The script defines a Shadow-DOM-rooted custom element and mounts it. No separate JS file, no external network requests at injection time.
- **D-02:** New module `src/widget-injector.ts` exports two functions:
  - `getWidgetScriptTag(opts: { manifestUrl: string; indexUrl: string; currentVersion: string }): string` — pure, returns the full `<script>...</script>` HTML string with values inlined
  - `injectWidgetIntoHtmlFiles(workdirVersionDir: string, opts: ...): Promise<number>` — walks the version subdirectory recursively, finds every `*.html` file, and inserts the script tag immediately before `</body>` (or before `</html>` as fallback if no `</body>`)
- **D-03:** Inject after `placeContent` and before the index render call in `branch-manager.ts`. The injection only touches files inside `<workdir>/<versionSlot>/`, not the root index.html.

### Widget runtime behavior
- **D-04:** Widget is a custom element `<gh-pm-nav>` that creates a Shadow DOM root in `mode: 'open'`, mounts a small floating button at `position: fixed; bottom: 16px; right: 16px; z-index: 2147483647`. Click toggles a panel listing all versions.
- **D-05:** On first interaction (button click), widget fetches `manifestUrl` (relative path back to root `versions.json` — computed at injection time as `../versions.json` for top-level deploys, or via the inlined absolute path). Result is cached in memory for the page lifetime.
- **D-06:** Panel UI: small card listing each version newest-first. Each row: version name + git ref. Current version is bold and non-clickable. Clicking another version navigates to its root (`../{version}/`). A separate "← Index" link at the top of the panel navigates to `../`.
- **D-07:** Loading state: spinner-text "Loading versions..." while fetch is in flight. Error state: "Could not load versions" if fetch fails — explicit failure, no silent empty state.
- **D-08:** Widget ships with NO build step. It's a literal string of vanilla JS / template literals embedded in `widget-injector.ts`. No bundling, no transpilation. Target: ES2020 (works in every browser shipping in the last 4 years).

### Style isolation
- **D-09:** All widget CSS lives inside the Shadow DOM via `<style>` tag injected into `shadowRoot`. No global CSS, no `!important`, no class collisions possible.
- **D-10:** Widget adopts CSS variables `prefers-color-scheme` for light/dark, mirroring Phase 3's palette so the index and widget feel cohesive.
- **D-11:** Floating button is `40px × 40px` circular with a hamburger-style icon (3 horizontal lines, pure SVG inline). Subtle box-shadow for elevation. The button never animates; opening the panel uses a `transform: translateY(...)` slide.

### Injection safety
- **D-12:** **Idempotency:** Injector checks if the marker comment `<!-- gh-pages-multiplexer:nav-widget -->` is already present in the HTML file. If yes, skip (don't double-inject). The marker is part of the script tag template.
- **D-13:** **Non-HTML files:** Injector only touches files matching `*.html` (case-insensitive). Never touches CSS, JS, JSON, images, etc.
- **D-14:** **Malformed HTML:** If `</body>` and `</html>` are both missing, the injector appends the script tag to the end of the file with a `core.warning` log. No fail — the file might still render the widget at the end.
- **D-15:** **No host-page interference:** Widget never reads or writes the host page DOM outside its own Shadow root. No event listeners on `document`. No global variables (everything in a closure).

### Failure handling
- **D-16:** Injection failures (e.g., file unreadable) FAIL LOUDLY and abort the deploy — the action is in an unknown state otherwise. No silent skip.
- **D-17:** If the version subdirectory contains zero `.html` files (e.g., user deployed only an asset bundle), injection is a no-op success — log "0 HTML files in {version}, no widget injection needed" at info level.

### Out of scope (this phase)
- Same-page cross-version navigation (preserving the path) → v2 (NAVE-01)
- Outdated version banner → v2 (NAVE-02)
- Widget customization (colors, position) → no v1 user demand, defer
- Search/filter inside the widget panel → v2 once version counts get large

### Claude's Discretion
- Exact icon SVG path
- Spinner styling
- Animation timing curves
</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Navigation Widget (NAVW-01..05)
- `.planning/ROADMAP.md` Phase 4

### Existing code (must read before planning)
- `src/branch-manager.ts` — pipeline integration point (after content placement, before commit)
- `src/content-placer.ts` — how content lands in `<workdir>/<versionSlot>/`
- `src/index-renderer.ts` — Phase 3 reference for inline-CSS / palette parity
- `.planning/phases/03-rich-index-page/03-UI-SPEC.md` — color tokens to mirror

### UI design spec (this phase produces it)
- `.planning/phases/04-navigation-widget/04-UI-SPEC.md` — widget visual/interaction contract

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `versions.json` schema is stable as of Phase 2 — widget can rely on `schema: 1 | 2`, `versions[].version`, `versions[].ref`.
- Phase 3 color tokens in `03-UI-SPEC.md` give the widget a ready-made palette to mirror — no fresh design work for theming.
- `branch-manager.ts` already iterates the version subdirectory after `placeContent` — adding a recursive HTML walk is one more call to a small helper.

### Established Patterns
- `[LAW:dataflow-not-control-flow]`: injection runs unconditionally for every deploy. Empty file lists are encoded in data (returns 0), not in a guarded skip.
- `[LAW:single-enforcer]`: `branch-manager.ts` is the only module that writes to the gh-pages worktree. The injector returns counts; branch-manager owns the actual write side effect via the injector's helper which itself is the I/O surface for HTML files.
- Real-fixture testing: tests build temp directories with sample HTML files and assert post-injection contents.

### Integration Points
- Hook 1: New `src/widget-injector.ts`
- Hook 2: `src/branch-manager.ts` — call `injectWidgetIntoHtmlFiles(workdir/versionSlot, opts)` after `placeContent` and before `writeManifest` (so manifest still reflects the deploy in the same atomic commit as the injected HTML)
- Hook 3: `__tests__/widget-injector.test.ts` — fixture HTMLs with various edge cases (missing `</body>`, multi-page deploy, idempotency on re-deploy, non-HTML files left alone, marker detection)
- Hook 4: E2E pipeline test that runs a full deploy and verifies the marker comment + script tag appear in the deployed file

</code_context>

<specifics>
## Specific Ideas

- The marker comment (`<!-- gh-pages-multiplexer:nav-widget -->`) is the idempotency seam — it's a single source of truth for "is this file already injected?" and avoids any need for content hashing or AST parsing.
- Custom element with Shadow DOM is the **only** mechanically-enforced way to inject UI into arbitrary user HTML without style collision. CSS scoping via class prefixes is policy-based and will eventually leak.
- The widget pulls from a relative path (`../versions.json`) so it works regardless of the gh-pages site URL — no hard-coded base URL.

</specifics>

<deferred>
## Deferred Ideas

- Same-page cross-version navigation (NAVE-01) — v2
- Outdated version banner (NAVE-02) — v2
- Widget customization API (colors, position, icon) — v2
- Search/filter inside widget panel — v2
- Aggregating widget across multiple repos — out of scope (multi-repo aggregation explicitly excluded)

</deferred>

---

*Phase: 04-navigation-widget*
*Context gathered: 2026-04-06 (assumptions mode, --auto)*
