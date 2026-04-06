---
phase: 04-navigation-widget
plan: 02
subsystem: deploy-pipeline
tags: [navigation-widget, pipeline-wiring, e2e-tests, dist-bundle]
requires:
  - 04-01 (widget-injector module)
  - 01-03 (branch-manager + deploy pipeline)
provides:
  - injectWidgetForVersion(workdir, versionSlot, repoMeta) on branch-manager
  - Stage 4.5 in deploy() pipeline (post-placeContent, pre-commitAndPush)
  - 6 E2E pipeline tests proving widget wiring
  - rebuilt dist/index.js bundling widget-injector
affects:
  - src/branch-manager.ts
  - src/index.ts
  - __tests__/branch-manager.test.ts
  - dist/index.js
tech-stack:
  added: []
  patterns:
    - Single-enforcer (branch-manager owns all gh-pages worktree writes)
    - Dataflow-not-control-flow (Stage 4.5 always runs; empty html list returns 0 from data)
    - One source of truth (relative URLs derived purely from versionSlot)
key-files:
  created: []
  modified:
    - src/branch-manager.ts
    - src/index.ts
    - __tests__/branch-manager.test.ts
    - dist/index.js
decisions:
  - injectWidgetForVersion accepts repoMeta but ignores it in v1 (future-proofing for PR previews)
  - Stage 4.5 placed AFTER placeContent so widget is injected into base-path-corrected HTML (T-04-09)
  - Order proof in Test 5 uses indexOf comparison (marker after <base> tag) -- behavior not structure
metrics:
  duration: ~6min
  completed: 2026-04-06
---

# Phase 4 Plan 2: Widget Pipeline Wiring Summary

Wired the navigation widget injector into the deploy pipeline as Stage 4.5, between placeContent and commitAndPush, so every deployed HTML file in the version subdirectory gets the widget in the same atomic git commit as the manifest and root index. Phase 4 (NAVW-01..05) is now functionally complete end-to-end.

## What Was Built

**`src/branch-manager.ts`** — Added `injectWidgetForVersion(workdir, versionSlot, _repoMeta)` helper. Wraps `injectWidgetIntoHtmlFiles` with relative URLs derived purely from `versionSlot` (`manifestUrl='../versions.json'`, `indexUrl='../'`, `currentVersion=versionSlot`). Single I/O enforcer for landing the widget on disk; pure script generation lives in widget-injector.ts.

**`src/index.ts`** — Inserted Stage 4.5 in `deploy()`:
```
1. writeManifest
2. writeIndexHtml (root)
3. placeContent (copy + base-path correction + .nojekyll)
4. injectWidgetForVersion  <-- NEW
5. commitAndPush
```

**`__tests__/branch-manager.test.ts`** — Added `describe('widget injection in deploy pipeline')` with 6 E2E tests. Real fs in tmpdir, no mocks. Each test runs writeIndexHtml → placeContent → injectWidgetForVersion at the function level (same wiring as deploy()).

| # | Test | Asserts |
|---|------|---------|
| 1 | full pipeline | every html in versionSlot has WIDGET_MARKER + currentVersion + manifestUrl; non-html bytes identical |
| 2 | root untouched | workdir/index.html does NOT contain WIDGET_MARKER |
| 3 | siblings untouched | pre-existing v0.9.0/index.html is byte-identical post-deploy |
| 4 | idempotent | second run returns 0; marker count per file is exactly 1 |
| 5 | wiring order | both `<base href="/widgets/v1.0.0/">` and WIDGET_MARKER present; marker indexOf > base indexOf |
| 6 | zero-html | no html files → returns 0, no marker anywhere in workdir |

**`dist/index.js`** — Rebuilt. Verified bundle contains `gh-pages-multiplexer:nav-widget` (1 match), `gh-pm-nav` (5 matches), `injectWidgetIntoHtmlFiles` (2 matches: definition + call site).

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|------------|
| T-04-09 (wrong wiring order corrupts widget URLs) | Stage 4.5 placed after placeContent; Test 5 asserts coexistence + position |
| T-04-10 (cross-version contamination) | Helper passes `path.join(workdir, versionSlot)`, never workdir; Test 3 |
| T-04-11 (atomicity break) | Stage 4.5 runs before commitAndPush — same atomic commit |
| T-04-12 (stale dist bundle) | Rebuilt + grep-verified for marker, custom element, function name |
| T-04-13 (silent error swallow) | No try/catch, no `\|\| true` in new code |
| T-04-14 (root index injected) | Walker scoped to versionSlot subdir; Test 2 |

## Verification Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 139/139 passing (was 133, +6 new E2E tests) |
| `npm run build` | succeeded |
| dist marker grep | gh-pages-multiplexer:nav-widget ×1, gh-pm-nav ×5, injectWidgetIntoHtmlFiles ×2 |

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `75d55ee` test(04-02): add failing E2E tests for widget injection in deploy pipeline (RED)
- `9d28d86` feat(04-02): wire widget injection into deploy pipeline (GREEN)
- `72fefe5` build(04-02): rebuild dist bundle with widget-injector

## Self-Check: PASSED

- src/branch-manager.ts has `export async function injectWidgetForVersion`: FOUND
- src/index.ts imports + calls injectWidgetForVersion: FOUND
- dist/index.js contains all 3 marker strings: FOUND
- All 3 commits exist in git log: FOUND
- 139/139 vitest pass: FOUND

---

## Live Browser Verification (chrome-devtools-mcp)

**Performed:** 2026-04-06 (orchestrator-driven)

Fixture: `/tmp/phase4-driver.mjs` injects widget into a host page with an aggressive red-everything CSS reset + `all: unset` button restyle. Served via `python3 -m http.server` to exercise real-fetch semantics.

| Check | Result |
|---|---|
| Button visible on closed state (bottom-right circle) | PASS (/tmp/phase4-closed.png) |
| Shadow DOM isolation vs `color: red !important` host reset | PASS — widget text dark on white, host `<h1>` still red |
| Click opens panel, `aria-expanded=true` | PASS |
| Panel header "Versions" + "← Index" link | PASS |
| Current version `v2.1.0` has "current" badge on accent-highlight row | PASS (/tmp/phase4-open-loaded.png) |
| All 3 versions listed with correct refs | PASS (versionCount=3) |
| Fetch of `../versions.json` | PASS (1 network request, 200) |
| Dark mode via `prefers-color-scheme` | PASS (/tmp/phase4-open-dark.png) |
| Mobile 375px — panel widens to viewport | PASS (/tmp/phase4-open-dark-mobile.png) |
| Console errors | 0 widget errors (1 unrelated `favicon.ico` 404 from browser auto-fetch) |
| Click on `feature-auth` navigates to `../feature-auth/` | PASS — `location.href` changed to `http://localhost:8765/feature-auth/` |
| No host-page interference (host `<h1>`, `<p>`, `<button>` unchanged) | PASS — visible in screenshots |

**Verdict (live):** NAVW-01..05 all satisfied with both code and live browser evidence. Shadow DOM `:host { all: initial; }` reset plus scoped tokens means the widget is mechanically immune to host CSS.
