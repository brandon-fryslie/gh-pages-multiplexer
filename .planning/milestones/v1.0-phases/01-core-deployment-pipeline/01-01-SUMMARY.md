---
phase: 01-core-deployment-pipeline
plan: 01
subsystem: scaffold
tags: [typescript, rollup, vitest, github-action]
requires: []
provides:
  - project-scaffold
  - type-contracts
  - parseInputs
  - action-metadata
affects:
  - package.json
  - tsconfig.json
  - rollup.config.ts
  - vitest.config.ts
  - action.yml
  - src/types.ts
  - src/index.ts
  - __tests__/inputs.test.ts
tech-stack:
  added: [typescript@5.9, rollup@4, vitest@4, "@actions/core@3", "@actions/exec@3", "@actions/io@3", picomatch@4]
  patterns: [esm-source-cjs-bundle, tdd-input-validation]
key-files:
  created:
    - package.json
    - tsconfig.json
    - rollup.config.ts
    - vitest.config.ts
    - .gitignore
    - action.yml
    - src/types.ts
    - src/index.ts
    - __tests__/inputs.test.ts
    - dist/index.js
  modified: []
decisions:
  - "Rollup TS plugin outDir overridden to ./dist in rollup.config.ts so the plugin's path-containment check passes, while tsconfig.json remains the source of truth for all other TS options"
  - "parseInputs exported as a named export so tests can drive it directly without spawning the action bundle"
metrics:
  duration: ~5min
  tasks: 3
  files: 10
  tests: 9
  completed: 2026-04-06
---

# Phase 01 Plan 01: Project Scaffold Summary

Greenfield scaffold of the gh-pages-multiplexer GitHub Action: TypeScript + Rollup (CJS bundle) + Vitest, with action.yml declaring the full input/output contract, shared type definitions for every pipeline stage, an entry-point stub exporting `parseInputs`, and 9 passing tests covering GHUB-02 input validation.

## What Was Built

- **Toolchain**: package.json (ESM), tsconfig.json (ES2022/NodeNext), rollup.config.ts (bundles `src/index.ts` -> `dist/index.js`, CJS), vitest.config.ts.
- **Action metadata**: action.yml declares `source-dir` (required), `target-branch`, `ref-patterns`, `base-path-mode`, `base-path-prefix`, `token` inputs and `version`, `url` outputs. `runs.using: node20` per locked D-01 with a TODO comment for the node24 migration.
- **Type contracts** (`src/types.ts`): `DeployConfig`, `DeploymentContext`, `ManifestEntry`, `Manifest` (with `schema: 1`), `DeployResult`. These are the sole contracts Wave 2/3 will code against.
- **Entry point** (`src/index.ts`): exported `parseInputs()` validates `source-dir` required, `base-path-mode` enum, splits/trims `ref-patterns`, reads `GITHUB_REPOSITORY`/`GITHUB_REF`; `run()` is stubbed.
- **Tests** (`__tests__/inputs.test.ts`): 9 vitest cases mocking `@actions/core`, covering required validation, enum validation (valid + invalid), ref-patterns parsing, env-var population, and full DeployConfig shape.

## Commits

| Task | Type | Hash | Message |
|------|------|------|---------|
| 1 | chore | 2e5a7cf | scaffold project with TypeScript, Rollup, and Vitest |
| 2 | feat | 3fa11f5 | add action.yml, type contracts, and entry point stub |
| 3 | test | 397d8e1 | add parseInputs validation tests (GHUB-02) |

## Verification

| Gate | Result |
|------|--------|
| `npm run build` produces `dist/index.js` | PASS |
| `npx vitest run` executes without framework errors | PASS (9/9) |
| `npx vitest run __tests__/inputs.test.ts` all pass | PASS (9/9) |
| Type interfaces exported from `src/types.ts` | PASS |
| action.yml valid YAML with all fields | PASS |

Rollup emits a harmless circular-dependency warning from `@actions/core` internals (oidc-utils <-> core); this is upstream and not actionable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] rollup-plugin-typescript outDir path containment**
- **Found during:** Task 2 (first `npm run build`)
- **Issue:** `@rollup/plugin-typescript` requires tsconfig `outDir` to live under the Rollup output directory. The plan specified `outDir: ./build` and `file: dist/index.js`, which fails the plugin's path check.
- **Fix:** Override `outDir: './dist'` (and disable `declaration`) in the plugin invocation in `rollup.config.ts`. tsconfig.json remains unchanged as the canonical source for all other options.
- **Files modified:** `rollup.config.ts`
- **Commit:** 3fa11f5

## Threat Model Status

- **T-01-02 (Tampering - action inputs)**: MITIGATED. `parseInputs` validates `base-path-mode` against the enum and relies on `@actions/core` `required: true` for `source-dir`. Tested in `__tests__/inputs.test.ts`.
- **T-01-01 (Tampering - ref sanitization)**: Deferred to Plan 02 as specified (contracts defined here in `DeploymentContext.versionSlot`).
- **T-01-03 (Elevation - token scope)**: Accepted; default token uses `${{ github.token }}`.
- **T-01-04 (Info disclosure - token in logs)**: Deferred to Plan 03 wiring; `core.setSecret` call will live in the final `run()`.

## Known Stubs

- `src/index.ts` `run()` returns `version='stub'`, `url='stub'` and emits info logs only. Intentional per plan; Plan 03 wires the real pipeline stages.

## Authentication Gates

None encountered.

## Self-Check: PASSED

- package.json, tsconfig.json, rollup.config.ts, vitest.config.ts, .gitignore: FOUND
- action.yml, src/types.ts, src/index.ts, __tests__/inputs.test.ts, dist/index.js: FOUND
- Commits 2e5a7cf, 3fa11f5, 397d8e1: FOUND in git log
- All 9 tests pass; `dist/index.js` builds cleanly
