---
phase: 01-core-deployment-pipeline
verified: 2026-04-06T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (automated); SC#5 needs live integration test
re_verification:
  previous_status: none
  initial: true
human_verification:
  - test: "Deploy to a real test repository via GitHub Actions"
    expected: "Action runs in CI runner, creates gh-pages branch (or appends to existing one), version subdirectory appears, links/assets resolve correctly in browser, manifest is updated"
    why_human: "GHUB-03 (works in standard runner) and SC#1/SC#4 (renders correctly from subdirectory) cannot be verified without an actual GitHub Actions environment with GITHUB_TOKEN, real git remote, and a browser to confirm asset/link resolution."
  - test: "Trigger two concurrent workflow runs deploying different versions to the same gh-pages branch"
    expected: "Both runs succeed; both version directories present in final gh-pages tree; both manifest entries present; no corruption"
    why_human: "Phase 1 SC#5 (concurrent deploy safety / DEPL-05) is implemented as a fetch-rebase-retry loop in commitAndPush (bounded at 3 attempts) and unit-tested with mocked exec, but real concurrency safety can only be confirmed by exercising the retry path against a live remote with two simultaneous pushes racing for the same ref."
  - test: "Deploy a site with deep relative asset paths and fragment-only links, then browse it"
    expected: "All <link>, <script>, <img>, <a> references load from the correct subdirectory; in-page #anchor links navigate within the same page (not back to root)"
    why_human: "DEPL-04 base-path correction (both base-tag and rewrite modes) is unit-tested at the string level; correct browser rendering is a behavioral check that requires a live page load."
---

# Phase 1: Core Deployment Pipeline — Verification Report

**Phase Goal:** Users can deploy any static site into a versioned subdirectory on gh-pages without destroying previous deployments.
**Verified:** 2026-04-06
**Status:** human_needed (all automated checks pass; live CI run still required)
**Re-verification:** No — initial verification

## Goal Achievement

### Roadmap Success Criteria

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | User can add the Action and deploy a build dir to a versioned subdirectory | ✓ AUTOMATED-VERIFIED / ? LIVE | action.yml declares `source-dir`/`target-branch`/etc.; `deploy()` in src/index.ts wires the 5-stage pipeline; dist/index.js bundle loads. Live CI run still needed. |
| 2 | New deployment preserves previously deployed version directories | ✓ VERIFIED | content-placer removes only the target versionSlot subdir before copy (`fs.rm(target,{recursive,force})`); __tests__/content-placer.test.ts and __tests__/deploy.test.ts seed a prior `v0.9.0/` slot and assert it survives a `v1.0.0` deploy (DEPL-01). |
| 3 | JSON manifest at root tracks all versions and is updated in same commit as content | ✓ VERIFIED | manifest-manager r/w + updateManifest (pure prepend/replace); deploy.test.ts asserts versions.json and version dir co-located in workdir before single `commitAndPush` (MNFST-04 atomicity at filesystem level). schema validation enforced on read. |
| 4 | Deployed sites render correctly from subdirectory | ✓ AUTOMATED-VERIFIED / ? LIVE | base-path.ts injectBaseHref/rewriteUrls handle `<base href>`, fragment links (Pitfall 2), existing-base replacement (Pitfall 3); `.nojekyll` always created. Browser-level rendering needs human check. |
| 5 | Two concurrent runs deploying different versions both succeed | ⚠ PARTIALLY VERIFIED | commitAndPush implements DEPL-05 fetch-rebase-retry (bounded 3 attempts), unit-tested with mocked exec for the retry path, max-retry exhaustion, and no-op short-circuit. Real-world concurrency requires live test. |

### Observable Truths (from PLAN must_haves)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Build produces dist/index.js | ✓ VERIFIED | `dist/index.js` exists, 1.0M; `node -e require()` reaches parseInputs runtime validation (no syntax/import errors) |
| 2 | Vitest framework runs | ✓ VERIFIED | `npx vitest run` exits 0, 65/65 tests passing |
| 3 | action.yml declares all required inputs/outputs | ✓ VERIFIED | source-dir (required), target-branch, ref-patterns, base-path-mode, base-path-prefix, token, version, url all present; runs.using=node20, runs.main=dist/index.js |
| 4 | TypeScript interfaces define pipeline contracts | ✓ VERIFIED | src/types.ts exports DeployConfig, DeploymentContext, ManifestEntry, Manifest (schema:1), DeployResult |
| 5 | parseInputs validates required + enum and constructs DeployConfig | ✓ VERIFIED | src/index.ts parseInputs throws on invalid base-path-mode; __tests__/inputs.test.ts (9 tests) cover all paths |
| 6 | Refs sanitized into safe single-segment dir names | ✓ VERIFIED | sanitizeRef strips refs/{tags,heads}/, maps PR refs, drops `..` segments structurally, removes control chars; __tests__/ref-resolver.test.ts has explicit traversal test |
| 7 | Ref patterns filter which refs deploy | ✓ VERIFIED | matchesPatterns uses picomatch.isMatch; resolveContext throws on mismatch |
| 8 | HTML files get `<base href>` injection with fragment fix | ✓ VERIFIED | base-path.ts injectBaseHref + Pitfall 2/3 tests in __tests__/base-path.test.ts |
| 9 | URL rewriting mode rewrites src/href | ✓ VERIFIED | rewriteUrls handles root-relative only, ignores protocol-absolute |
| 10 | Content copied without disturbing siblings | ✓ VERIFIED | content-placer + deploy.test.ts integration test |
| 11 | Manifest read/write/update correct + idempotent | ✓ VERIFIED | manifest-manager.test.ts covers ENOENT→empty, schema validation, prepend, replace-on-redeploy, no-mutation |
| 12 | Worktree used (no main checkout disturbed) | ✓ VERIFIED | branch-manager.prepareBranch uses `git worktree add` to `os.tmpdir()` |
| 13 | Push failure → fetch-rebase-retry (DEPL-05) | ✓ VERIFIED | branch-manager.commitAndPush bounded loop; branch-manager.test.ts simulates failures and asserts sequence + max-retry throw |
| 14 | Manifest + content in single commit (MNFST-04) | ✓ VERIFIED | Both written to same workdir before single commitAndPush; deploy.test.ts asserts co-location |
| 15 | Full pipeline wired end-to-end | ✓ VERIFIED | src/index.ts deploy() runs all 5 stages in fixed order with try/finally cleanup |
| 16 | dist/index.js builds and loads | ✓ VERIFIED | 1.0M bundle, loads under Node |
| 17 | Action outputs version + url after deploy | ✓ VERIFIED | core.setOutput('version'/'url') in run() |
| 18 | Custom domain repos use real CNAME contents | ✓ VERIFIED | readCnameFile returns trimmed string|null; index.ts uses it for baseUrl computation (no `<custom-domain>` placeholder) |

**Score:** 18/18 truths verified at the automated level; SC#1, SC#4 require live human test, SC#5 partially verified.

### Required Artifacts

| Artifact | Status | Notes |
|---|---|---|
| package.json | ✓ VERIFIED | type=module, build/test scripts, @actions/core/exec/io, picomatch as runtime dep |
| tsconfig.json | ✓ VERIFIED | ES2022, NodeNext, strict |
| rollup.config.ts | ✓ VERIFIED | input src/index.ts, output dist/index.js cjs |
| vitest.config.ts | ✓ VERIFIED | imports vitest/config, includes __tests__/**/*.test.ts |
| action.yml | ✓ VERIFIED | All inputs/outputs, runs.main dist/index.js, runs.using node20 |
| src/types.ts | ✓ VERIFIED | All 5 interfaces exported, 43 lines |
| src/ref-resolver.ts | ✓ VERIFIED | sanitizeRef/matchesPatterns/resolveContext, 79 lines, imports picomatch |
| src/base-path.ts | ✓ VERIFIED | injectBaseHref/rewriteUrls, 39 lines |
| src/content-placer.ts | ✓ VERIFIED | placeContent, imports base-path, 58 lines |
| src/manifest-manager.ts | ✓ VERIFIED | readManifest/updateManifest/writeManifest, 52 lines |
| src/branch-manager.ts | ✓ VERIFIED | prepareBranch/commitAndPush/cleanupWorktree/readCnameFile, 111 lines, mocked-exec tests |
| src/index.ts | ✓ VERIFIED | Imports all stage modules; 5 stages in fixed order; try/finally cleanup; setSecret on token; 102 lines |
| dist/index.js | ✓ VERIFIED | 1.0M bundle, loads under Node |
| __tests__/*.test.ts (7 files) | ✓ VERIFIED | 65 tests total, all passing |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| rollup.config.ts | src/index.ts | input entry | ✓ WIRED |
| action.yml | dist/index.js | runs.main | ✓ WIRED |
| src/content-placer.ts | src/base-path.ts | import | ✓ WIRED |
| src/ref-resolver.ts | picomatch | import | ✓ WIRED |
| src/index.ts | src/ref-resolver.ts | import resolveContext | ✓ WIRED |
| src/index.ts | src/branch-manager.ts | import prepareBranch/commitAndPush/cleanupWorktree/readCnameFile | ✓ WIRED |
| src/index.ts | src/manifest-manager.ts | import readManifest/updateManifest/writeManifest | ✓ WIRED |
| src/index.ts | src/content-placer.ts | import placeContent | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full test suite passes | `npx vitest run` | exit 0, 65 tests pass | ✓ PASS |
| Bundle loads under Node | `node -e "require('./dist/index.js')"` | reaches parseInputs runtime validation (`Invalid base-path-mode: ""`), no syntax/import errors | ✓ PASS |
| Build succeeds | (verified pre-existing dist/index.js, 1.0M, matches plan 03 SUMMARY) | dist/index.js present | ✓ PASS |

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|---|---|---|---|---|
| DEPL-01 | 02 | Deploy without disturbing existing version dirs | ✓ SATISFIED | content-placer + deploy.test.ts seeds prior version |
| DEPL-02 | 02 | Version subdir derived from git ref | ✓ SATISFIED | sanitizeRef + resolveContext |
| DEPL-03 | 02 | Glob/regex patterns filter refs | ✓ SATISFIED | matchesPatterns (picomatch) |
| DEPL-04 | 02 | Base path correction | ✓ SATISFIED | base-path.ts (both modes) |
| DEPL-05 | 03 | Concurrent deploy safety | ✓ SATISFIED (unit) / ? LIVE | commitAndPush retry loop, unit-tested |
| MNFST-01 | 02 | JSON manifest as single source of truth | ✓ SATISFIED | manifest-manager.ts + schema validation |
| MNFST-04 | 03 | Manifest + content in same commit | ✓ SATISFIED | Both staged before single commit; deploy.test.ts |
| GHUB-01 | 01,03 | Packaged as GitHub Action | ✓ SATISFIED | action.yml + dist/index.js |
| GHUB-02 | 01,03 | Action accepts required inputs | ✓ SATISFIED | action.yml + parseInputs + tests |
| GHUB-03 | 03 | Works in standard runner | ✓ SATISFIED (structural) / ? LIVE | Uses node20, @actions/core/exec, std git CLI |

No orphaned requirements — all 10 phase requirements claimed by at least one plan.

### Anti-Patterns Found

None. Spot scan of src/index.ts, branch-manager.ts, ref-resolver.ts: no TODO/FIXME (one TODO comment in action.yml is the documented node24 migration note from D-01, not a stub), no `return null/[]/{}` stubs, no empty handlers, no defensive null guards in violation, no hardcoded empty props. Universal-laws annotations (`// [LAW:...]`) are present and accurate in src/index.ts and src/branch-manager.ts.

`run()` no longer returns the `'stub'` placeholders from Plan 01 — it sets real outputs from the deploy() result.

### Human Verification Required

See frontmatter `human_verification` block. Three items:

1. **Live CI deploy** — verifies SC#1/SC#4/GHUB-03 against a real GitHub Actions runner
2. **Concurrent-deploy race** — verifies SC#5/DEPL-05 retry path under real contention
3. **Browser rendering of deployed site** — verifies DEPL-04 base-path correction at the rendering level

### Gaps Summary

No automated gaps. The phase implementation is complete, all 65 tests pass, all artifacts exist and are wired correctly, the bundle builds and loads, and every must-have truth from the plan frontmatter is verified at the code/test level.

The remaining uncertainty is intrinsic: GitHub Actions deployment correctness, live concurrency safety, and browser rendering of base-path-corrected pages cannot be verified without live execution in a real runner against a real remote. These are routed to the human verification queue per the standard verifier policy on visual / external-service / real-time behaviors.

---

_Verified: 2026-04-06_
_Verifier: Claude (gsd-verifier)_
