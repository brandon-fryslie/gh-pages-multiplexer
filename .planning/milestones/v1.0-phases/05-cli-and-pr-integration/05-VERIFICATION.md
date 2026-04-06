---
phase: 05-cli-and-pr-integration
verified: 2026-04-06T07:08:00Z
status: passed
score: 6/6 must-haves verified
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 5: CLI and PR Integration Verification Report

**Phase Goal:** Ship a standalone CLI adapter (GHUB-04) and a PR sticky preview comment (GHUB-05), sharing the same `deploy()` pipeline as the Action adapter.
**Verified:** 2026-04-06T07:08:00Z
**Status:** passed

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Shared `deploy()` used by both adapters (one-type-per-behavior) | VERIFIED | `src/deploy.ts:19` exports `deploy(config, sourceRepoDir)`; `src/index.ts:13` and `src/cli.ts:11` both `import { deploy } from './deploy.js'`; both call it (`index.ts:51`, `cli.ts:130`). Pipeline logic exists only in `deploy.ts`. |
| 2 | `dist/cli.js` has shebang and runs `--help`/`--version` | VERIFIED | Line 1 of `dist/cli.js` is `#!/usr/bin/env node`. `node dist/cli.js --version` prints `gh-pages-multiplexer 0.0.0`. `node dist/cli.js --help` prints full usage starting `Usage: gh-pages-multiplexer deploy [options]`. |
| 3 | `package.json` declares `bin.gh-pages-multiplexer -> ./dist/cli.js` | VERIFIED | `package.json:7-9` — `"bin": { "gh-pages-multiplexer": "./dist/cli.js" }`. |
| 4 | `pr-commenter.ts` exports marker-based upsert with 403 warn-not-fail, wired post-deploy in bounded try/catch | VERIFIED | `src/pr-commenter.ts:13` exports `PREVIEW_COMMENT_MARKER`; `:59` exports `upsertPreviewComment`; list/select/write pipeline (`:66-108`) uses marker matching (`.find(... includes(MARKER))` at `:82`); `is403` discriminator at `:46` scopes swallow to HTTP 403 only, rethrows others (`:78`, `:107`); `src/index.ts:14` imports, `:62-82` wires post-deploy inside bounded try/catch with outer 403/warning-only handling (`:77-81`). Documented as the single swallow boundary (D-19). |
| 5 | CLI reads token from `GITHUB_TOKEN`/`GH_TOKEN` env only, no `--token` flag | VERIFIED | `src/cli.ts:93` — `env.GITHUB_TOKEN ?? env.GH_TOKEN ?? ''`. `parseArgs` options at `:68-77` contain NO `token` entry; `strict: true` would reject `--token`. Error path at `:82-86` explicitly redirects users who try to pass a token flag. |
| 6 | Full vitest green | VERIFIED | `npm test` → **Test Files 13 passed (13), Tests 165 passed (165)**, 10.90s duration. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/deploy.ts` | Shared pipeline | VERIFIED | 87 lines, 5 ordered stages, unconditional dataflow structure; cited laws in comments |
| `src/cli.ts` | CLI adapter | VERIFIED | 153 lines, argv+env → DeployConfig → deploy(), no pipeline logic |
| `src/index.ts` | Action adapter | VERIFIED | 88 lines, thin @actions/core wrapper around deploy() + PR commenter |
| `src/pr-commenter.ts` | Marker-based upsert | VERIFIED | 109 lines, single module owns marker+body+403 boundary |
| `dist/cli.js` | Bundled executable | VERIFIED | Exists, shebang on line 1, runs end-to-end for --help/--version |
| `package.json#bin` | CLI entrypoint | VERIFIED | Maps `gh-pages-multiplexer` → `./dist/cli.js` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/index.ts` | `src/deploy.ts` | `import { deploy }` + `await deploy(config, sourceRepoDir)` at :51 | WIRED |
| `src/cli.ts` | `src/deploy.ts` | `import { deploy }` + `await deploy(config, process.cwd())` at :130 | WIRED |
| `src/index.ts` | `src/pr-commenter.ts` | `import { upsertPreviewComment }` + call inside post-deploy try/catch at :69-81 | WIRED |
| `dist/cli.js` | `package.json#bin` | `"gh-pages-multiplexer": "./dist/cli.js"` | WIRED |
| CLI | token env | `env.GITHUB_TOKEN ?? env.GH_TOKEN` at cli.ts:93; no `--token` in parseArgs options | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real? | Status |
|----------|------|--------|-------|--------|
| `cli.ts` main() | `config: DeployConfig` | Built from real `parseArgs(rest)` + `env.GITHUB_TOKEN`/`env.GITHUB_REPOSITORY`/`env.GITHUB_REF` | Yes | FLOWING |
| `cli.ts` main() | `result` | Real `await deploy(config, process.cwd())`; printed to stdout | Yes | FLOWING |
| `pr-commenter` | `comments` | Real `octokit.rest.issues.listComments`; drives find-by-marker | Yes | FLOWING |
| `pr-commenter` | `matched` | Real `.find()` over listed comments; drives update vs create branch (data-driven) | Yes | FLOWING |
| `index.ts` PR block | `pr.number`, `result.url`, `result.version` | Real `github.context.payload.pull_request` + real deploy result | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI version | `node dist/cli.js --version` | `gh-pages-multiplexer 0.0.0` | PASS |
| CLI help | `node dist/cli.js --help` | Full usage block, documents env-only token | PASS |
| Full test suite | `npm test` | 165/165 passed, 13 files | PASS |
| Shebang | `head -1 dist/cli.js` | `#!/usr/bin/env node` | PASS |

### Anti-Patterns Found

None. Null guards at trust boundaries only (env.GITHUB_TOKEN fallback, optional github.context.payload.pull_request). Single documented swallow (`is403` in pr-commenter.ts, bounded try/catch in index.ts) — both cited with `[LAW:no-defensive-null-guards] exception` and rationale (D-19). No TODO/FIXME/stub patterns. No hardcoded empty data flowing to user-visible output. `parseArgs` strict mode prevents silent acceptance of unknown flags.

### Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| GHUB-04 | CLI adapter sharing deploy() | SATISFIED | Truths 1, 2, 3, 5 |
| GHUB-05 | PR sticky preview comment | SATISFIED | Truth 4 |

### Human Verification Required

None. All goals verified programmatically. The CLI executes end-to-end for --help/--version, the bundle is built and wired through `bin`, the PR commenter is marker-upsert with tested 403 semantics, and all 165 tests pass. No runtime PR flow exists to test without a live GitHub workflow, but the module contracts are covered by the test suite.

### Gaps Summary

No gaps. Phase 5 achieves both requirements cleanly. The `deploy()` extraction in 05-01 eliminated duplication between the Action and CLI adapters (one-type-per-behavior), and 05-02 added the PR commenter as a bounded, data-driven upsert respecting the D-19 swallow boundary. The law citations throughout (`[LAW:one-type-per-behavior]`, `[LAW:dataflow-not-control-flow]`, `[LAW:single-enforcer]`, `[LAW:no-defensive-null-guards] exception: D-19`) match the architectural intent and are load-bearing in the code structure, not decorative.

---

_Verified: 2026-04-06T07:08:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Live Verification (end-to-end, 2026-04-06)

Validated against real repo: https://github.com/brandon-fryslie/ghpm-validation
Local checkout: `/tmp/ghpm-validation/`

### Step 1 — CLI deploy path

Command (run from `/tmp/ghpm-validation`):
```
GITHUB_SHA=$(git rev-parse HEAD) GITHUB_TOKEN=$(gh auth token) \
  node /Users/bmf/code/gh-pages-multiplexer/dist/cli.js deploy \
  --source-dir=site-cli/v9.0.0-cli \
  --target-branch=gh-pages \
  --ref=refs/tags/v9.0.0-cli \
  --repo=brandon-fryslie/ghpm-validation \
  --base-path-mode=rewrite
```
Exit code: `0`
Final stdout: `Deployed v9.0.0-cli to https://brandon-fryslie.github.io/ghpm-validation/v9.0.0-cli/`

gh-pages proof (after `git fetch origin gh-pages`):
- `git ls-tree origin/gh-pages` shows `v9.0.0-cli/` tree present alongside prior versions.
- `versions.json` diff shows a new entry with `version: "v9.0.0-cli"`, `ref: "refs/tags/v9.0.0-cli"`, `sha: 2ab38b8...`, and 3 extracted commits (Phase 2 metadata path exercised).
- Root `index.html` (Phase 3) regenerated with `<h2>v9.0.0-cli</h2>` + `href="./v9.0.0-cli/"`.
- `v9.0.0-cli/index.html` contains `<!-- gh-pages-multiplexer:nav-widget -->` and `var CURRENT = "v9.0.0-cli";` — Phase 4 widget injected. CLI went through the same shared `deploy()` pipeline as the Action (one-type-per-behavior confirmed live).

### Step 2 — PR sticky comment upsert

PR: https://github.com/brandon-fryslie/ghpm-validation/pull/1 (`phase5-pr-test` → `main`)

Workflow change pushed to `main` first: added `pull_request: branches:[main]`, `permissions: pull-requests: write`, and `fetch-depth: 0` on `actions/checkout@v4`.

Two deploy-action runs targeted PR #1:
- First run (initial PR open): run `24033087311` — success. Log line: `Updated PR #1 preview comment`.
- Second run (trigger rerun via push `4e229f7`): run `24033182753` — success.

Comment upsert proof (`gh api repos/brandon-fryslie/ghpm-validation/issues/1/comments`):
- Exactly ONE comment matching `<!-- gh-pages-multiplexer:preview -->`.
- Comment id: `4192425546` (same across both runs).
- Before (run 1): body includes `_Updated at 2026-04-06T13:11:22.663Z_`, `updated_at: 2026-04-06T13:11:22Z`.
- After  (run 2): body includes `_Updated at 2026-04-06T13:14:20.682Z_`, `updated_at: 2026-04-06T13:14:20Z`.
- Same id, same marker, new timestamp → upsert is idempotent and correct.

### Step 3 — Live GitHub Pages check

- `curl -sI https://brandon-fryslie.github.io/ghpm-validation/v9.0.0-cli/` → `HTTP/2 200`.
- Response body (`/tmp/v9page.html`) contains `<!-- gh-pages-multiplexer:nav-widget -->` and `var CURRENT = "v9.0.0-cli";`.
- `curl -s https://brandon-fryslie.github.io/ghpm-validation/` root index contains `<h2>v9.0.0-cli</h2>` and `href="./v9.0.0-cli/"`, confirming the root index was regenerated and served.

### Bugs found + fixed mid-validation

Two bugs surfaced on the PR rerun (run `24033102361` failed initially):

1. `src/branch-manager.ts` — `prepareBranch` ran `git fetch origin gh-pages --depth=1` in the source repo's cwd, which silently *shallowed* the source clone. On reruns, `git log previousSha..currentSha` then failed with an "unreachable in shallow clone" error and (per D-11) refused to fall back. **Fix:** drop `--depth=1` from the source-repo fetch; gh-pages branches are small and the full fetch is safe.
2. `src/metadata-extractor.ts` — `isShallowRepo` treated any presence of `.git/shallow` as shallow, but `actions/checkout@v4 fetch-depth:0` can leave an empty shallow file behind after unshallowing. **Fix:** treat present-but-empty `.git/shallow` as *not shallow*.

Both fixes were committed to the source repo, dist rebuilt, copied into the test repo, and re-verified live — the subsequent PR run (`24033182753`) succeeded end-to-end and the sticky comment was upserted on the same id.

### Artifacts

- `/tmp/v9page.html` — full v9.0.0-cli page (200, widget present)
- `/tmp/rootindex.html` — gh-pages root index (contains v9.0.0-cli row)
- PR: https://github.com/brandon-fryslie/ghpm-validation/pull/1
- Preview URL (sticky comment target): https://brandon-fryslie.github.io/ghpm-validation/pr-1/

### Verdict

**PASS.** Both deliverables proved live:
1. CLI adapter deploys through the shared `deploy()` pipeline, producing identical artifacts to the Action (manifest, root index, widget injection).
2. PR sticky comment is upserted (single comment id across reruns, body timestamp updates) under the documented D-19 swallow boundary.

_Live verified: 2026-04-06_

