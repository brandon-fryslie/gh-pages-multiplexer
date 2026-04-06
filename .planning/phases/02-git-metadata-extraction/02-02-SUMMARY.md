---
phase: 02-git-metadata-extraction
plan: 02
subsystem: metadata-extraction
tags: [pipeline, manifest, schema, e2e]
requires:
  - src/metadata-extractor.ts (extractCommits)
  - src/manifest-manager.ts (readManifest, updateManifest, writeManifest)
  - src/types.ts (Manifest, ManifestEntry, CommitInfo)
provides:
  - Schema 2 manifest writer (reader still accepts 1|2)
  - Pipeline wiring: extractCommits as unconditional Stage 3 sub-step
  - E2E proof of per-deploy commit history correctness
affects:
  - src/manifest-manager.ts
  - src/index.ts
  - __tests__/manifest-manager.test.ts
  - __tests__/deploy.test.ts
  - __tests__/pipeline-metadata.test.ts
  - dist/index.js
tech_stack:
  added: []
  patterns:
    - dataflow-not-control-flow (extractCommits is unconditional; previousSha null vs value is the only variability)
    - one-source-of-truth (D-02: schema bump, reader tolerant, writer canonical)
key_files:
  created:
    - __tests__/pipeline-metadata.test.ts
  modified:
    - src/manifest-manager.ts
    - src/index.ts
    - __tests__/manifest-manager.test.ts
    - __tests__/deploy.test.ts
    - dist/index.js
decisions:
  - D-02 applied: reader accepts schema 1|2, writer always emits 2
  - sourceRepoDir captured from process.cwd() at run() entry (D-10) before prepareBranch changes context
  - previousSha derived from in-memory manifest lookup (no extra I/O)
metrics:
  duration: ~8 min
  completed: 2026-04-06
  tasks: 3
  files: 6
requirements: [META-03, MNFST-02, MNFST-03]
---

# Phase 2 Plan 2: Pipeline Wiring and Schema 2 Summary

Wired `extractCommits` into the deploy pipeline as an unconditional stage between `readManifest` and `updateManifest`, bumped the manifest writer to schema 2 (reader remains backward-compatible with schema 1), and proved end-to-end via a no-mock fixture test suite that two successive deploys record the correct per-deploy commit histories.

## What Was Built

- **`src/manifest-manager.ts`**: `readManifest` now accepts `schema === 1 || schema === 2` and returns `{ schema: 2, versions: [] }` on ENOENT. `updateManifest` always returns `schema: 2`, and the existing spread semantics already preserve `entry.commits` on the inserted ManifestEntry.
- **`src/index.ts`**: `run()` captures `sourceRepoDir = process.cwd()` at the top (before any stage runs, before `prepareBranch` creates the gh-pages worktree). `deploy(config, sourceRepoDir)` threads it into Stage 3, which now looks up `previousSha` from the in-memory manifest and calls `extractCommits(sourceRepoDir, context.sha, previousSha)` unconditionally. `entry.commits` is populated on every deploy — no null guards, no try/catch, failures propagate loudly per D-11.
- **`__tests__/pipeline-metadata.test.ts`**: 4 end-to-end tests on real fixture git repos — no mocks of the extractor or manifest modules. Covers first deploy, incremental range, schema-1 legacy read with schema-2 rewrite, and multi-slot isolation.
- **`dist/index.js`**: rebuilt via `npm run build` — bundles metadata-extractor alongside the rest of the Action.

## Tasks & Commits

| # | Task | Commit |
|---|------|--------|
| 1 | Manifest reader 1|2 / writer schema 2 + commits preservation | 1b95057 |
| 2 | Wire extractCommits into deploy pipeline (sourceRepoDir, previousSha) | 369cc54 |
| 3 | End-to-end pipeline metadata test + dist rebuild | ae172fb |

## Verification

- `npx tsc --noEmit`: clean
- `npx vitest run` (full suite): **78/78 pass** (72 prior + 4 new pipeline E2E + 2 updated manifest-manager cases)
- `grep -n extractCommits src/index.ts`: import at line 13, call site at line 61
- `grep -n "schema: 2" src/manifest-manager.ts`: ENOENT default and updateManifest return
- `npm run build`: successful, `dist/index.js` present
- `grep -c extractCommits dist/index.js`: 3 (function is bundled)
- `grep "|| true\|2>/dev/null"` on `src/index.ts` and `src/manifest-manager.ts`: no swallowed errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing schema-1 assertions in `__tests__/manifest-manager.test.ts` and `__tests__/deploy.test.ts`.**
- **Found during:** Task 1 verification (`npx vitest run`)
- **Issue:** Three Phase 1 assertions hard-coded `schema: 1` as the expected output of the manifest reader/writer. Bumping the writer to schema 2 made them fail. These tests encoded the old contract, not the new one.
- **Fix:** Updated the three assertions to `schema: 2`, and added two new positive cases to `manifest-manager.test.ts`: one proving `updateManifest` preserves `entry.commits`, and one proving `readManifest` accepts an on-disk `"schema": 2` file. This keeps the contract tests current with the new writer and locks in D-02 behavior.
- **Files modified:** `__tests__/manifest-manager.test.ts`, `__tests__/deploy.test.ts`
- **Commit:** 1b95057 (bundled with Task 1)

## Key Decisions

- **D-02 schema bump landed as planned**: reader is tolerant (`1 | 2`), writer is canonical (`2`). One source of truth for on-disk schema, no dual-write, no migration step.
- **`sourceRepoDir` captured at the very top of `run()` (D-10)**: this is structurally important — `prepareBranch` changes `process.cwd()` when it creates the worktree. Capturing earlier would work; capturing later would silently point git log at the wrong directory. Explicit threading beats ambient cwd.
- **`previousSha` via in-memory `find`**: no extra disk read, no extra git command. The manifest we already parsed is the single source of truth for "what did we deploy last time for this slot."
- **No null guard on `commits.length`**: an empty array is the correct data representation of "no new commits since last deploy for this slot." The pipeline treats it exactly the same as a populated array — the variability is in the value, not the control flow.

## Inherited Decision Honored

Plan 02-01 introduced `.git/shallow` detection so D-11 (loud fail) wins over D-12 (silent fallback) when the clone is shallow. The pipeline wiring in this plan deliberately does NOT wrap `extractCommits` in a try/catch — a shallow-clone failure propagates through `deploy()` and `run().catch(...)` to `core.setFailed`, exactly as intended. The E2E fixture tests all use full (non-shallow) repos, so they exercise the normal path; the shallow-failure path is already covered by the `metadata-extractor.test.ts` suite from Plan 02-01.

## Known Stubs

None. The manifest now contains real commit history on every deploy. Downstream consumers (Phase 3 index renderer, Phase 4 widget) can rely on `ManifestEntry.commits` being populated for every schema-2 entry.

## Self-Check: PASSED

- FOUND: src/manifest-manager.ts (schema 1|2 reader, schema 2 writer)
- FOUND: src/index.ts (extractCommits import line 13, sourceRepoDir line 97, call site line 61)
- FOUND: __tests__/pipeline-metadata.test.ts (4 E2E tests, no mocks of extractor/manifest)
- FOUND: dist/index.js (contains extractCommits, 3 occurrences)
- FOUND commit: 1b95057
- FOUND commit: 369cc54
- FOUND commit: ae172fb
- Full test suite: 78/78 pass
