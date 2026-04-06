---
phase: 03-rich-index-page
plan: 03
subsystem: deployment-pipeline
tags: [index-page, pipeline-wiring, integration-test, dist]
requires:
  - src/index-renderer.ts (renderIndexHtml from Plan 03-02)
  - src/branch-manager.ts (commitAndPush git add -A)
  - src/manifest-manager.ts (writeManifest)
provides:
  - writeIndexHtml(workdir, manifest, repoMeta) in src/branch-manager.ts
  - Pipeline wiring so index.html ships in the deploy commit with versions.json
affects:
  - src/branch-manager.ts
  - src/index.ts
  - __tests__/branch-manager.test.ts
  - __tests__/pipeline-metadata.test.ts
  - dist/index.js
  - package.json (tslib devDep)
tech-stack:
  added:
    - tslib (devDep, required by @rollup/plugin-typescript)
  patterns:
    - single-enforcer for gh-pages worktree writes preserved
    - unconditional pipeline side effects (dataflow-not-control-flow)
key-files:
  created: []
  modified:
    - src/branch-manager.ts
    - src/index.ts
    - __tests__/branch-manager.test.ts
    - __tests__/pipeline-metadata.test.ts
    - dist/index.js
    - dist/package.json
    - package.json
    - package-lock.json
decisions:
  - Compute repoMeta in src/index.ts from config.repo split on '/'; branch-manager stays I/O-only.
  - No modification to commitAndPush — existing `git add -A` stages the new index.html.
  - Pipeline integration test uses a real git-backed gh-pages workdir and asserts via `git log -1 --name-only` that versions.json and index.html are in the same commit.
  - Freshness asserted by comparing index.html content between two deploys with different version slots (non-flaky — does not depend on wall-clock granularity).
metrics:
  tasks: 3
  tests_added: 9
  tests_total: 113
  duration: ~8m
  completed: 2026-04-06
---

# Phase 03 Plan 03: Pipeline Wiring for Rich Index Page Summary

Wired renderIndexHtml into the deploy pipeline via a new writeIndexHtml I/O helper in branch-manager, added unit + pipeline E2E tests proving index.html lands in the same commit as versions.json, and rebuilt the action bundle.

## What Shipped

- `writeIndexHtml(workdir, manifest, repoMeta)` exported from `src/branch-manager.ts` — the sole I/O enforcer that lands the rendered HTML on the gh-pages worktree. Thin wrapper over the pure renderer.
- `src/index.ts` computes `repoMeta` from `config.repo` and calls `writeIndexHtml` unconditionally immediately after `writeManifest`, before `placeContent`/`commitAndPush`. No control-flow gate.
- 4 unit tests for writeIndexHtml (exists, content matches renderer output, overwrites stale, idempotent).
- 4 pipeline integration tests in `__tests__/pipeline-metadata.test.ts`:
  - Same-commit assertion (`git log -1 --name-only` contains both files)
  - Well-formed `<!doctype html` + version slug presence
  - Redeploy freshness (content differs between two version-slot deploys)
  - First-ever deploy on orphan-equivalent branch
- dist/index.js rebuilt; contains renderIndexHtml + prefers-color-scheme; zero `<script` substrings. dist/package.json `{"type":"commonjs"}` preserved.

## Verification Results

- `npx tsc --noEmit`: clean
- `npx vitest run`: 113/113 tests green across 34 files
- `npm run build`: success, dist bundle regenerated
- grep gates: `writeIndexHtml` present in branch-manager + index.ts; no `writeFile` in index.ts; no `if ... writeIndexHtml` gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing tslib devDependency**
- **Found during:** Task 3 (`npm run build`)
- **Issue:** `@rollup/plugin-typescript` requires `tslib` but it was not installed, causing the rollup build to fail.
- **Fix:** `npm install --save-dev tslib`.
- **Files modified:** package.json, package-lock.json
- **Commit:** c560816 (rolled into the dist rebuild commit)

## Commits

- b48402f feat(03-03): wire writeIndexHtml into pipeline; add unit tests
- dfcc838 test(03-03): assert index.html lands in same commit as versions.json on deploy
- c560816 build(03-03): rebuild dist bundle with index-renderer; full suite green

## Success Criteria

- [x] INDX-01 — auto-generated index.html at root of gh-pages displays deployed versions (asserted by integration test)
- [x] INDX-06 — index.html regenerated every deploy from manifest (freshness assertion)
- [x] Same-commit contract with versions.json (MNFST-04 extension)
- [x] branch-manager remains single enforcer of gh-pages worktree writes
- [x] No control-flow guards on the renderer call
- [x] dist bundle rebuilt and ships new module
- [x] Full suite green (113/113)

## Self-Check: PASSED

- FOUND: src/branch-manager.ts (writeIndexHtml export)
- FOUND: src/index.ts (writeIndexHtml call)
- FOUND: __tests__/branch-manager.test.ts (writeIndexHtml describe)
- FOUND: __tests__/pipeline-metadata.test.ts (index.html-in-deploy-commit describe)
- FOUND: dist/index.js (contains renderIndexHtml)
- FOUND: dist/package.json ({"type":"commonjs"})
- FOUND: commit b48402f
- FOUND: commit dfcc838
- FOUND: commit c560816
