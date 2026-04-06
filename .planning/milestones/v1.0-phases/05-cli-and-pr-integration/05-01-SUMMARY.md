---
phase: 05-cli-and-pr-integration
plan: 01
subsystem: deploy-pipeline-extraction
tags: [refactor, seam, adapter-split]
requires: [01, 02, 03, 04]
provides:
  - "src/deploy.ts exports async deploy(config, sourceRepoDir): Promise<DeployResult>"
  - "src/index.ts is a pure Action adapter (parseInputs + run + core.* I/O)"
  - "Seam for Plan 05-02 CLI adapter to share pipeline"
affects: [src/index.ts, src/deploy.ts]
tech-stack:
  added: []
  patterns: [one-type-per-behavior, variability-at-edges]
key-files:
  created: [src/deploy.ts]
  modified: [src/index.ts]
decisions:
  - "Byte-for-byte move, no behavior change"
  - "LAW annotations preserved + extended with one-type-per-behavior + variability-at-edges"
metrics:
  duration: ~3min
  tasks: 2
  files: 2
  tests: 139/139
completed: 2026-04-06
---

# Phase 5 Plan 01: Extract Shared deploy() Into src/deploy.ts Summary

Pure structural refactor: extracted private `deploy(config, sourceRepoDir)` from `src/index.ts` into new `src/deploy.ts` as a named export, byte-for-byte. `src/index.ts` shrank from 131 → 60 lines and is now a clean Action adapter importing `deploy` from `./deploy.js`. Zero behavior change; 139/139 tests pass unchanged. Seam ready for Plan 05-02 to land `src/cli.ts` as a second adapter.

## Tasks Completed

| Task | Name                                                         | Commit   |
| ---- | ------------------------------------------------------------ | -------- |
| 1    | Create src/deploy.ts by moving pipeline body verbatim        | e1fd49e  |
| 2    | Rewire src/index.ts to import deploy + delete local copy     | a8836bb  |

## Verification

- `npx tsc --noEmit` clean
- `npx vitest run` → 139/139 passing, 38/38 suites, zero test modifications
- `grep "from './deploy.js'" src/index.ts` → 1 match
- `grep "^async function deploy" src/index.ts` → 0 matches
- `grep "export async function deploy" src/deploy.ts` → 1 match
- LAW annotations preserved: `[LAW:dataflow-not-control-flow]`, `[LAW:single-enforcer]`, plus added `[LAW:one-type-per-behavior]` and `[LAW:variability-at-edges]` documenting the seam's reason

## Deviations from Plan

None — plan executed exactly as written.

## Key Decisions

- **Byte-for-byte move**: The deploy body was copied unchanged, including the `core.setSecret(config.token)` masking, the try/finally block, the `cleanupWorktree(...).catch(...)` bridge, and every log string. Any divergence would be a bug.
- **Trust the compiler for unused imports**: After deletion from index.ts, `tsc --noEmit` confirmed the remaining imports (`core`, `DeployConfig`) are all still used.
- **LAW annotation split**: The original `[LAW:dataflow-not-control-flow]` + `[LAW:single-enforcer]` annotations now live at the top of `src/deploy.ts` (closer to the pipeline they govern) with the Action-adapter framing reprised at the top of `src/index.ts`.

## Threat Mitigations Landed

- **T-05-01 (silent behavior drift)**: Mitigated by byte-for-byte copy + full 139-test regression gate passing with zero test modifications.
- **T-05-02 (lost LAW annotations)**: Both original annotations preserved in `src/deploy.ts`; two new annotations added documenting the extraction's reason.
- **T-05-03 (token masking lost)**: `if (config.token) core.setSecret(config.token);` preserved at top of deploy body.
- **T-05-04 (broken cleanup)**: try/finally + `cleanupWorktree.catch` preserved verbatim.
- **T-05-06 (unused-import drift)**: `tsc --noEmit` clean after rewire.

## Files

- **Created**: `src/deploy.ts` (87 lines)
- **Modified**: `src/index.ts` (131 → 60 lines, −78 / +7)

## Self-Check: PASSED

- FOUND: src/deploy.ts
- FOUND: src/index.ts
- FOUND commit: e1fd49e
- FOUND commit: a8836bb
- Tests: 139/139 green
- tsc: clean
