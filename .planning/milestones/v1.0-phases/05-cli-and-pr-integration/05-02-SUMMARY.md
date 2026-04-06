---
phase: 05-cli-and-pr-integration
plan: 02
subsystem: cli-and-pr-commenter
tags: [cli, pr-comment, rollup, adapter]
requires: [05-01]
provides: [cli-entry, pr-sticky-comment, bin-field]
affects: [src/index.ts, rollup.config.ts, package.json, dist/index.js, dist/cli.js]
tech-added: ["@actions/github ^9.0.0"]
patterns: [marker-based-upsert, parseArgs-from-node-util, two-bundle-rollup, variability-at-edges]
key-files:
  created:
    - src/cli.ts
    - src/pr-commenter.ts
    - __tests__/cli.test.ts
    - __tests__/pr-commenter.test.ts
  modified:
    - src/index.ts
    - rollup.config.ts
    - package.json
    - package-lock.json
    - dist/index.js
    - dist/cli.js
decisions:
  - "Duplicate shebang: rollup banner + source shebang both emitted. Removed shebang from src/cli.ts; rollup banner is the single source of truth for the byte-zero shebang."
requirements: [GHUB-04, GHUB-05]
metrics:
  tasks: 2
  completed: 2024-04-06
---

# Phase 5 Plan 2: CLI and PR Integration Summary

Second adapter onto the shared `deploy()` pipeline (CLI via `parseArgs`/env) plus a marker-based sticky PR preview comment wired into the Action adapter; both bundled via an independent-bundle rollup config.

## What Shipped

- **src/cli.ts** — `main(argv, env)` adapter: `parseArgs` from `node:util`, env-only token resolution (`GITHUB_TOKEN` > `GH_TOKEN`), unix exit codes (0/1/2), `--help`/`--version`/`--debug`, require.main guard so tests import cleanly.
- **src/pr-commenter.ts** — `upsertPreviewComment(octokit, opts)` with `PREVIEW_COMMENT_MARKER = '<!-- gh-pages-multiplexer:preview -->'`, three-step dataflow pipeline (list → select by marker → write), `is403` swallow discriminator, D-12 body template.
- **src/index.ts** — post-deploy PR context check (`pull_request`/`pull_request_target` + `pr.number` + `owner/repo`), calls `upsertPreviewComment` inside the single documented D-19 swallow boundary.
- **rollup.config.ts** — array of two independent CJS bundles: `src/index.ts → dist/index.js` and `src/cli.ts → dist/cli.js` with `banner: '#!/usr/bin/env node'`.
- **package.json** — `@actions/github ^9.0.0` dep, `"bin": { "gh-pages-multiplexer": "./dist/cli.js" }`.
- **Tests** — 14 cli tests + 12 pr-commenter tests. Mock octokit is hand-rolled; `@actions/core` is `vi.mock`'d for the warning spy (ESM namespaces are non-configurable so `spyOn` doesn't work).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate shebang in dist/cli.js**
- **Found during:** Build smoke test (`node dist/cli.js --version` threw `SyntaxError: Invalid or unexpected token`).
- **Issue:** Both the source-file shebang and the rollup `banner` emitted `#!/usr/bin/env node`, so line 2 was a bare `#!/usr/bin/env node` that Node parsed as an expression → syntax error.
- **Fix:** Removed the shebang from `src/cli.ts` (the `banner` option is the single source of truth per [LAW:one-source-of-truth]). TypeScript would also reject a top-of-file shebang in a module anyway.
- **Files modified:** src/cli.ts
- **Commit:** 6742aa2 (initial impl) + eb93c5c (rebuild)

**2. [Rule 1 - Bug] `vi.spyOn(core, 'warning')` fails on ESM namespace**
- **Found during:** First pr-commenter test run.
- **Issue:** `Cannot spy on export "warning". Module namespace is not configurable in ESM.`
- **Fix:** Replaced the `spyOn` with `vi.mock('@actions/core', () => ({ warning: vi.fn(), info: vi.fn(), setSecret: vi.fn() }))` at file top, then `vi.mocked(core.warning)` for assertions.
- **Files modified:** __tests__/pr-commenter.test.ts

## Verification

- `npx tsc --noEmit` — clean
- `npx vitest run` — **165 passed / 0 failed** (139 pre-existing + 14 cli + 12 pr-commenter)
- `head -1 dist/cli.js` → `#!/usr/bin/env node` (byte zero)
- `node dist/cli.js --version` → `gh-pages-multiplexer 0.0.0` exit 0
- `node dist/cli.js deploy` (no token) → stderr error, exit 2
- `dist/cli.js` and `dist/index.js` both exist, both CJS
- `@actions/github` present in `dependencies`, `bin` field present in `package.json`

## Key Decisions

- **Rollup `banner` is the sole shebang source** — removed from source file after discovering double-emit. [LAW:one-source-of-truth].
- **`@actions/core` must be `vi.mock`'d at top of test file** — ESM namespace exports are non-configurable; `spyOn` is not an option. Established pattern for future tests that need to observe `core.warning`/`core.info`.
- **First-marker-wins is deterministic** — `comments.find(...)` gives stable ordering from the GitHub API response. Accepted residual risk T-05-10 (attacker races to post a fake marker) per threat model.

## Self-Check: PASSED

- src/cli.ts FOUND
- src/pr-commenter.ts FOUND
- __tests__/cli.test.ts FOUND
- __tests__/pr-commenter.test.ts FOUND
- dist/cli.js FOUND with shebang
- Commits cc14658, a9e0029, 80da8e4, 6742aa2, 93d39c4, cead6d1, eb93c5c all FOUND in git log
