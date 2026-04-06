---
phase: 01-core-deployment-pipeline
plan: 03
subsystem: git-operations-and-pipeline-wiring
tags: [typescript, vitest, git-worktree, github-actions, rollup-bundle]
requires:
  - project-scaffold
  - type-contracts
  - ref-resolver
  - manifest-manager
  - content-placer
provides:
  - branch-manager
  - full-deployment-pipeline
  - action-bundle
affects:
  - src/branch-manager.ts
  - src/index.ts
  - __tests__/branch-manager.test.ts
  - __tests__/deploy.test.ts
  - dist/index.js
tech-stack:
  added: []
  patterns: [mocked-exec-tdd, try-finally-cleanup, bounded-retry-loop, data-driven-stages]
key-files:
  created:
    - src/branch-manager.ts
    - __tests__/branch-manager.test.ts
    - __tests__/deploy.test.ts
  modified:
    - src/index.ts
    - dist/index.js
decisions:
  - "branch-manager wraps all git invocations in a single `git()` helper that always passes `ignoreReturnCode: true`, so exit codes are data the caller branches on -- not exceptions that jump control flow"
  - "push-retry uses a fixed bounded loop (maxRetries default 3) with fetch+rebase between attempts; no exponential backoff (GitHub concurrency groups handle contention externally per T-01-09)"
  - "deploy() uses try/finally so cleanupWorktree always runs; cleanup failure is downgraded to a warning and never masks the original error"
  - "URL output reads the actual CNAME file contents via readCnameFile (returns string|null), eliminating the '<custom-domain>' placeholder trap -- the url output is always a real, navigable URL"
  - "Integration test exercises the pipeline at the filesystem level (manifest + version dir co-located under workdir) rather than spinning up a real git worktree; this keeps tests fast and deterministic while still proving MNFST-04 atomicity"
requirements:
  - DEPL-05
  - MNFST-04
  - GHUB-01
  - GHUB-02
  - GHUB-03
metrics:
  duration: ~10min
  tasks: 2
  files: 5
  tests: 65
  completed: 2026-04-06
---

# Phase 01 Plan 03: Git Operations and Full Pipeline Wiring Summary

Implemented the git-operations module (`branch-manager`) and wired the complete five-stage deployment pipeline in `src/index.ts`, producing a working GitHub Action bundle at `dist/index.js`. All 65 tests across the suite pass; the bundle loads and reaches runtime input validation without any syntax or import errors.

## What Was Built

- **`src/branch-manager.ts`** (`prepareBranch`, `commitAndPush`, `cleanupWorktree`, `readCnameFile`) -- wraps `@actions/exec` with a single `git()` helper that always captures exit codes (`ignoreReturnCode: true`). `prepareBranch` configures git identity, embeds the token into the `origin` remote URL for authenticated push, and uses the `git fetch` exit code as data to pick between `worktree add origin/<branch>` (existing branch) and `worktree add --detach` + `checkout --orphan` + `rm -rf .` (first-time deploy). `commitAndPush` is idempotent (no-op when `diff --cached --quiet` exits 0) and implements the DEPL-05 fetch-rebase-retry loop with a bounded attempt counter; throws only after exhausting all retries. `readCnameFile` returns the trimmed domain string or `null` on ENOENT -- no other error is swallowed.
- **`src/index.ts`** -- replaces the Plan 01 stub with the full `deploy()` function. Five stages always run in order: `prepareBranch` -> `readCnameFile` + `resolveContext` -> `readManifest`/`updateManifest`/`writeManifest` -> `placeContent` -> `commitAndPush`. `try/finally` guarantees `cleanupWorktree` runs on both success and failure paths; cleanup failure is logged as a warning and cannot mask the original error. Token is masked via `core.setSecret` (T-01-08). URL output uses the real CNAME domain when present, otherwise derives `<owner>.github.io` from `GITHUB_REPOSITORY`.
- **`__tests__/branch-manager.test.ts`** -- 9 tests using a mocked `@actions/exec`. Verifies the configure-then-fetch-then-worktree sequence, the orphan-branch fallback when fetch fails, the token embedded in the remote URL, the `diff --cached --quiet` no-op short-circuit, the retry-with-rebase loop, max-retries exhaustion throwing, `cleanupWorktree` using `--force`, and `readCnameFile` against a real tempdir for both the hit and miss cases.
- **`__tests__/deploy.test.ts`** -- 2 filesystem-level integration tests. The first writes manifest and content into the same workdir and verifies `versions.json`, `v1.0.0/index.html`, the injected `<base href>`, and `.nojekyll` all exist (proving a single `git add -A` would capture them together -- MNFST-04 atomic). The second seeds a prior `v0.9.0/` slot plus manifest entry, runs the pipeline stages for `v1.0.0`, and verifies both version directories coexist and the manifest contains both entries newest-first (DEPL-01 additive placement).
- **`dist/index.js`** -- 1.08 MB rolled-up bundle built via `npm run build`. Loads under Node without syntax/import errors (reaches `parseInputs` runtime validation, which is the first point where real Actions inputs are required).

## Commits

| Task | Type | Hash    | Message |
|------|------|---------|---------|
| 1 (RED)   | test | fd1ccb2 | add failing tests for branch-manager |
| 1 (GREEN) | feat | 463c4b1 | implement branch-manager with worktree, push-retry, and CNAME reader |
| 2         | feat | abf0302 | wire full deployment pipeline and build dist bundle |

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run __tests__/branch-manager.test.ts` | PASS (9/9) |
| `npx vitest run __tests__/deploy.test.ts` | PASS (2/2) |
| Full suite `npx vitest run` | PASS (65/65) |
| `npm run build` -> `dist/index.js` | Created, 1,085,227 bytes |
| `node -e "require('./dist/index.js')"` | Loads, reaches `parseInputs` runtime validation (no syntax/import errors) |
| Five stages in fixed order in `src/index.ts` | Confirmed via grep (prepareBranch -> readCnameFile/resolveContext -> readManifest/updateManifest/writeManifest -> placeContent -> commitAndPush) |
| `try/finally` around deploy for worktree cleanup | Confirmed |

## Must-Haves Truths

- [x] Git worktree is used to operate on gh-pages without disturbing the main checkout
- [x] Push failures trigger fetch-rebase-retry loop (DEPL-05, bounded at 3 attempts)
- [x] Version content and manifest update land in a single git commit (MNFST-04) -- both written to the same workdir before a single `commitAndPush`
- [x] Full pipeline runs end-to-end: `parseInputs` -> `resolveContext` -> `prepareBranch` -> `updateManifest` -> `placeContent` -> `commitAndPush`
- [x] `dist/index.js` is built and loads without syntax/import errors in Node
- [x] Action outputs `version` and `url` after successful deployment
- [x] Custom domain repos use actual CNAME file contents for `url` output (not a placeholder)

## Deviations from Plan

None -- plan executed exactly as written. TDD RED phase for `branch-manager` produced the expected "Cannot find module" failure, resolved by the GREEN implementation. No auto-fixes (Rules 1-3) were needed; no architectural decisions (Rule 4) arose.

## Threat Model Status

- **T-01-08 (Information Disclosure - token in remote URL)**: MITIGATED. Token is embedded in the `origin` remote URL for authenticated push, and `deploy()` calls `core.setSecret(config.token)` before any git command runs so the Actions runtime masks it in logs.
- **T-01-09 (DoS - retry loop)**: MITIGATED. `commitAndPush` uses a hard-coded bounded loop (`maxRetries` default 3). There is no unbounded backoff and no way for a caller to exceed the cap without passing it explicitly.
- **T-01-10 (Tampering - versions.json)**: ACCEPTED per plan. `readManifest` still validates `schema === 1`.
- **T-01-11 (Repudiation - deploy commit authorship)**: ACCEPTED per plan. Commits author as `github-actions[bot]`.

No new trust boundaries or surfaces were introduced beyond the plan's threat model.

## Known Stubs

None. The pipeline is fully wired end-to-end. The only remaining work is live integration testing against a real GitHub repo, which belongs to a later phase.

## Authentication Gates

None encountered. No human-verify, decision, or human-action checkpoints were triggered.

## Self-Check: PASSED

- `src/branch-manager.ts`: FOUND
- `src/index.ts`: FOUND
- `__tests__/branch-manager.test.ts`: FOUND
- `__tests__/deploy.test.ts`: FOUND
- `dist/index.js`: FOUND (1,085,227 bytes)
- Commits `fd1ccb2`, `463c4b1`, `abf0302`: FOUND in git log
- Full test suite: 65/65 passing, exit 0
- `dist/index.js` loads under Node (reaches `parseInputs` runtime validation, no syntax/import errors)
