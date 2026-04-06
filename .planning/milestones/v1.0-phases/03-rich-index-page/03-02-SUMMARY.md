---
phase: 03-rich-index-page
plan: 02
subsystem: index-renderer
tags: [rendering, css, xss, html-validate]
requires:
  - 03-01 (skeleton, escapeHtml, contract)
provides:
  - Full UI-SPEC-compliant renderIndexHtml output
  - Inline CSS with light/dark tokens and mobile breakpoint
  - Proven XSS mitigation across version/commit-message/author-name surfaces
  - html-validate gate in test suite
affects:
  - src/index-renderer.ts
  - __tests__/index-renderer.test.ts
  - package.json
tech_stack_added:
  - html-validate (devDependency)
patterns:
  - Pure data-driven rendering (no conditional side effects)
  - Single escape enforcer at every user-data interpolation
  - Static CSS literal (no user interpolation into <style>)
key_files_created: []
key_files_modified:
  - src/index-renderer.ts
  - __tests__/index-renderer.test.ts
  - package.json
  - package-lock.json
decisions:
  - DOCTYPE emitted uppercase (<!DOCTYPE html>) to satisfy html-validate:recommended doctype-style rule
  - formatUtc uses UTC getters with Invalid-Date fallback to raw string (data-driven, no throw)
  - CSS kept as single static constant INLINE_STYLE; no user data flows into <style>
metrics:
  tasks: 2
  completed_date: 2026-04-06
---

# Phase 3 Plan 2: Full Index Rendering + CSS + XSS Gates

Extended the `src/index-renderer.ts` skeleton from Plan 03-01 into a full UI-SPEC-compliant renderer: semantic header with linked repo name, version cards with `<time datetime>` timestamps, mono ref + short-SHA GitHub commit link + `View →` link, singular/plural commit `<details>` block with commit rows (`{shortSha} {subject} — {author}`), inline CSS with light/dark tokens via `prefers-color-scheme` and a 600px mobile breakpoint, and proven XSS mitigation verified by crafted payloads and an `html-validate` gate.

## What Was Built

- **Inline style block (static literal)** — every design token from UI-SPEC Pillar 4, dark theme via `@media (prefers-color-scheme: dark)`, mobile override via `@media (max-width: 600px)`. Zero user data interpolated into `<style>` (T-03-07 mitigation).
- **Header** — `<h1><a href="https://github.com/{owner}/{repo}" title="View on GitHub">{owner}/{repo}</a></h1>`.
- **Version card body** — `version-head` with `<h2>` + `<time datetime=...>YYYY-MM-DD HH:MM UTC</time>`; `meta` row with mono ref, mono short-SHA link to `/commit/{sha}`, and `View →` link to `./{version}/`.
- **Commits block** — data-driven: empty array collapses to `''`; populated array emits `<details><summary>{N} commit(s)</summary><ul class="commits">...</ul></details>` with correct singular/plural wording.
- **Commit row** — `<li><span class="mono">{shortSha}</span> {subject} <span class="muted">— {author}</span></li>`; subject is `message.split('\n')[0]`, body discarded.
- **formatUtc helper** — pure; returns raw ISO string if `new Date(iso)` is NaN (data-driven fallback, not a silent skip).
- **html-validate** — added as devDependency; test suite imports `HtmlValidate` and asserts both a simple and realistic fixture pass with `html-validate:recommended` (only `no-inline-style` disabled; no XSS/accessibility rules touched).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Uppercased DOCTYPE**
- **Found during:** Task 2 verification (html-validate gate failure)
- **Issue:** `<!doctype html>` triggered `doctype-style: DOCTYPE should be uppercase` in html-validate:recommended. The skeleton from 03-01 emitted lowercase.
- **Fix:** Changed to `<!DOCTYPE html>`. Existing 03-01 skeleton test used `.toLowerCase().startsWith('<!doctype html')` so it continues to pass.
- **Files modified:** src/index-renderer.ts
- **Commit:** 0ffc3f4

**2. [Rule 3 - Blocking] Updated 03-01 h1 regex test**
- **Found during:** Task 1 test design
- **Issue:** Existing skeleton test `<h1[^>]*>acme\/widgets<\/h1>` was incompatible with the Plan 03-02 requirement that h1 wrap an `<a>` tag. The test asserted implementation structure (no child elements), not the behavior (heading contains repo name).
- **Fix:** Relaxed regex to `<h1[^>]*>[\s\S]*acme\/widgets[\s\S]*<\/h1>` (behavior: repo name appears inside h1). [LAW:behavior-not-structure]
- **Files modified:** __tests__/index-renderer.test.ts
- **Commit:** 757acf0

## Tests

- **Total in suite:** 27 tests in `__tests__/index-renderer.test.ts` (11 from 03-01 + 16 new)
- **Full project:** 105/105 pass, 32 test files
- **New test groups:** `full card rendering`, `CSS / theming`, `XSS mitigation`, `html-validate gate`
- **XSS payloads verified:** `<script>alert(1)</script>` in version name; `<img src=x onerror=alert(1)>` in commit message; `"><script>alert(1)</script>` in author name (verifies attribute-context escape of `"` via `&quot;`).

## Threat Model Follow-through

All `mitigate` dispositions from the plan's `<threat_model>` have executable tests:
- T-03-03 (XSS version name) — escaped, tested
- T-03-04 (XSS commit message) — escaped, tested
- T-03-05 (XSS author name) — escaped, tested
- T-03-06 (attribute context) — `"` → `&quot;`, spot-check test confirms no `"><script` substring
- T-03-07 (CSS injection) — static literal, no interpolation

## Law Annotations

Added `[LAW:dataflow-not-control-flow]` annotations on `formatUtc` (Invalid-Date data fallback) and `renderCommitDetailsBlock` (empty-array data collapse). `[LAW:single-enforcer]` on `renderCommitRow` and `renderVersionCard` confirming every user field goes through `escapeHtml()`.

## Commits

- `757acf0` test(03-02): add failing tests for full index-renderer card body, CSS tokens, and XSS gates
- `0ffc3f4` feat(03-02): full index-renderer card body, inline CSS with dark mode, XSS mitigation

## Verification Gates (all green)

1. `npx tsc --noEmit` — clean
2. `npx vitest run __tests__/index-renderer.test.ts` — 27/27 pass
3. `grep '<script' src/index-renderer.ts` — no matches
4. `grep 'prefers-color-scheme: dark' src/index-renderer.ts` — 1 match
5. `grep 'max-width: 600px' src/index-renderer.ts` — 1 match
6. `html-validate` gate — green on simple + realistic fixtures
7. Full project suite: 105/105 pass

## Handoff to Plan 03-03

`renderIndexHtml(manifest, repoMeta)` signature unchanged from 03-01. Plan 03-03 wires it into `branch-manager.ts`: after `writeManifest`, call the renderer, write to `<workdir>/index.html`, stage both files in the atomic commit (D-03). No contract changes required.

## Self-Check: PASSED

- FOUND: src/index-renderer.ts
- FOUND: __tests__/index-renderer.test.ts
- FOUND: commit 757acf0
- FOUND: commit 0ffc3f4
