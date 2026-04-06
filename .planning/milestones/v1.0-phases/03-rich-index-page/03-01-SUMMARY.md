---
phase: 03-rich-index-page
plan: 01
subsystem: index-renderer
tags: [renderer, html, pure-function, xss, skeleton]
requires:
  - src/types.ts (Manifest, ManifestEntry, CommitInfo)
provides:
  - src/index-renderer.ts :: renderIndexHtml(manifest, repoMeta) pure function
  - src/index-renderer.ts :: escapeHtml(raw) helper
  - src/index-renderer.ts :: RepoMeta interface
affects: []
tech-stack:
  added: []
  patterns:
    - Pure function renderer (zero I/O) producing a single self-contained HTML string
    - Single-enforcer XSS mitigation via escapeHtml() at every user-data interpolation
    - Data-driven edge cases (empty manifest, missing commits[]) via value selection, not control-flow skips
key-files:
  created:
    - src/index-renderer.ts
    - __tests__/index-renderer.test.ts
  modified: []
decisions:
  - "Made renderIndexHtml a total pure function of its inputs by deriving the 'generated at' footer timestamp from manifest.versions[0].timestamp instead of new Date().toISOString(); wall-clock calls broke determinism under concurrent test scheduling and violated the pure-function contract the plan locks in."
  - "Plan 03-02 can replace the derivation if a wall-clock is wanted, but only by threading it through RepoMeta or a separate clock parameter — keeping purity intact."
metrics:
  duration: ~8m
  tasks: 2
  files: 2
  tests_added: 11
  tests_total_passing: 89
  completed: 2026-04-06
---

# Phase 3 Plan 1: Index Renderer Skeleton Summary

Pure `renderIndexHtml(manifest, repoMeta)` contract locked with an `escapeHtml()` single-enforcer and data-driven handling of empty manifests and legacy schema-1 entries; zero I/O, 11 fixture tests green, full suite 89/89.

## What Was Built

- **`src/index-renderer.ts`** — new module exporting:
  - `RepoMeta { owner; repo }` interface
  - `escapeHtml(raw)` mapping `&`, `<`, `>`, `"`, `'`
  - `renderIndexHtml(manifest, repoMeta)` returning a complete `<!doctype html>` document with `<html lang="en">`, locked title (`{owner}/{repo} — Deployed Versions`, em-dash U+2014), h1, subtitle (singular/plural), versions section, and footer freshness signal
  - Internal helpers `renderVersionCard`, `renderCommitDetailsBlock`, `renderEmptyState` — all pure string builders, every user-data interpolation wrapped in `escapeHtml()`
  - `[LAW:*]` annotations (one-source-of-truth, dataflow-not-control-flow, single-enforcer) on the module header and at every data-driven selection point
- **`__tests__/index-renderer.test.ts`** — 11 fixture-based tests, no mocks, no fs, no git. Covers: purity (deterministic output), empty-manifest copy, doctype/lang/title, h1, singular+plural subtitle, legacy `commits: undefined` → no `<details>`, schema-2 `commits: []` → no `<details>`, escapeHtml correctness, version-name XSS escape, footer freshness.

## Task Flow

| # | Task | Commit |
|---|------|--------|
| 1 | Write failing tests for renderIndexHtml skeleton + escapeHtml (RED) | `6a196de` |
| 2 | Implement src/index-renderer.ts skeleton to pass failing tests (GREEN) | `fb670e8` |

## Verification Gates Run

- `npx tsc --noEmit` — clean
- `npx vitest run __tests__/index-renderer.test.ts` — 11/11 passing
- `npx vitest run` (full suite) — **89/89 passing** (previous baseline 78 + 11 new)
- `grep escapeHtml src/index-renderer.ts` — helper defined and used at every user-data interpolation
- `grep LAW:single-enforcer src/index-renderer.ts` — annotation present

## Must-Haves Verified

All truths in the plan frontmatter:
- [x] `src/index-renderer.ts` exports `renderIndexHtml(manifest, repoMeta)` as a pure function
- [x] `renderIndexHtml` has zero I/O (no fs, no network) — and now zero wall-clock calls either
- [x] `escapeHtml()` defined and correct for `&`, `<`, `>`, `"`, `'`
- [x] Empty manifest renders without throwing, emits the locked Pillar 5 copy
- [x] `ManifestEntry` without `commits[]` renders a card with no `<details>` section
- [x] Output starts with `<!doctype html>` and contains `<html lang="en">`
- [x] Output is a single self-contained string (only a stub `<style>` block; Plan 03-02 fills it)
- [x] Tests use real fixture `Manifest` objects; no mocks
- [x] `npx vitest run __tests__/index-renderer.test.ts` passes
- [x] `npx tsc --noEmit` clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wall-clock timestamp broke the pure-function contract**

- **Found during:** Task 2 GREEN verification (full suite run revealed the purity test intermittently failing under concurrent scheduling).
- **Issue:** The initial implementation used `new Date().toISOString()` for the footer's "generated at" signal. The plan's Task 1 Test 1 asserts purity: two back-to-back calls with identical inputs must return identical strings. Under vitest's full-suite concurrent scheduling, two calls could straddle a millisecond boundary, producing different output and failing the purity contract the plan's must-haves lock in ("renderIndexHtml has zero I/O" — wall-clock reads are effectively I/O on the ambient clock).
- **Fix:** Derived `generatedAt` from `manifest.versions[0].timestamp` (newest deploy's timestamp) for populated manifests and `''` for empty ones. This makes `renderIndexHtml` a **total pure function of its inputs** with no ambient dependencies. The footer still serves as a freshness signal — it reflects the most recent deploy, which is exactly what the audience cares about.
- **Files modified:** `src/index-renderer.ts`
- **Commit:** `fb670e8` (the fix was folded into the GREEN commit before it landed)
- **Follow-up for Plan 03-02:** If a wall-clock "rendered at" is actually wanted (distinct from "latest deploy at"), thread it through `RepoMeta` (`now?: string`) or a separate clock parameter. Do NOT re-introduce an ambient `new Date()` — that would re-break purity.

## Known Stubs

The `<style>` block is an empty comment placeholder (`<style>/* Plan 03-02 fills this in */</style>`). This is intentional and explicitly documented in the plan's Task 2 action notes — Plan 03-02 replaces it with the full UI-SPEC design tokens, card layout, dark mode, and mobile breakpoint. The skeleton tests do not assert on CSS, only on structural/textual substrings.

`renderVersionCard` emits a minimal stub body (`<h2>`, ref line, optional `<details>` block). Plan 03-02 fills in the full card per UI-SPEC Pillar 1 (timestamp, short SHA link, View → link, commit rows). This is the plan's explicit scope boundary.

No stubs block the plan's goal (locking the pure function contract + edge-case wiring).

## Threat Surface

No new threat flags. The single trust boundary (`manifest.versions -> rendered HTML`) and both STRIDE entries (T-03-01 stored XSS, T-03-02 repoMeta tampering) from the plan's `<threat_model>` are mitigated by `escapeHtml()` applied at every interpolation — verified directly by Test 9 (escapeHtml correctness) and Test 10 (version-name XSS escape). Plan 03-02 will extend coverage to commit messages, author names, and the full html-validate gate.

## Self-Check: PASSED

- `src/index-renderer.ts` — FOUND
- `__tests__/index-renderer.test.ts` — FOUND
- Commit `6a196de` — FOUND
- Commit `fb670e8` — FOUND
- Full test suite — 89/89 passing
- `npx tsc --noEmit` — clean

---

*Plan 03-01 complete. Wave 1 of 3 for phase 03-rich-index-page.*
