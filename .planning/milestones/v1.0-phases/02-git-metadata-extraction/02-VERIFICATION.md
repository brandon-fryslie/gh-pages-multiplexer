---
phase: 02-git-metadata-extraction
verified: 2026-04-06T00:00:00Z
status: passed
score: 23/23 must-haves verified
---

# Phase 2: Git Metadata Extraction Verification Report

**Phase Goal:** Extract per-deploy git commit history (range-aware, capped, force-push tolerant) and land it in versions.json under schema 2 while remaining backward compatible with schema 1.
**Verified:** 2026-04-06
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

#### Plan 02-01 (data shape + extractor)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | `CommitInfo` exported with sha, author_name, author_email, message, timestamp | VERIFIED | src/types.ts:28-34 |
| 2   | `ManifestEntry.commits?: CommitInfo[]` | VERIFIED | src/types.ts:42 |
| 3   | `Manifest.schema` is `1 \| 2` | VERIFIED | src/types.ts:48 |
| 4   | `extractCommits(repoDir, currentSha, previousSha)` shells out via execFile | VERIFIED | src/metadata-extractor.ts:8,33-39,82-86 |
| 5   | previousSha non-null reachable -> logs `previousSha..currentSha` | VERIFIED | src/metadata-extractor.ts:88-89,98 |
| 6   | previousSha null -> logs from currentSha capped at 100 | VERIFIED | src/metadata-extractor.ts:87-89; -n MAX_COMMITS at line 37 |
| 7   | Unreachable previousSha (force-push) -> falls back, logs via core.info | VERIFIED | src/metadata-extractor.ts:101-112 |
| 8   | Hard cap of 100 enforced regardless of range | VERIFIED | -n MAX_COMMITS (line 37) + slice (line 118) |
| 9   | git log format uses `%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e` | VERIFIED | src/metadata-extractor.ts:18-20 |
| 10  | Full multiline messages preserved | VERIFIED | parseLog rejoins after FIELD_SEP (line 69); test 7 covers it |
| 11  | Shallow clone failure is loud, mentions `fetch-depth: 0` | VERIFIED | src/metadata-extractor.ts:24-31, 102-106, 47-50 |
| 12  | Fixture-based tests, no mocks, cover all 7 cases | VERIFIED | __tests__/metadata-extractor.test.ts (7 it() blocks, real `git init`) |
| 13  | metadata-extractor vitest passes | VERIFIED | full vitest run: PASS (78) FAIL (0) |

#### Plan 02-02 (wiring + schema)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 14  | readManifest accepts schema 1 and 2 | VERIFIED | src/manifest-manager.ts:26 |
| 15  | updateManifest always emits schema 2 | VERIFIED | src/manifest-manager.ts:43 |
| 16  | updateManifest preserves entry.commits | VERIFIED | src/manifest-manager.ts:39-45 (entry spread) + E2E-1/E2E-3 tests |
| 17  | sourceRepoDir captured at run() start before prepareBranch | VERIFIED | src/index.ts:96-102 (before deploy() / prepareBranch) |
| 18  | previousSha derived from manifest.versions.find(...).sha ?? null | VERIFIED | src/index.ts:58-59 |
| 19  | extractCommits called between readManifest and updateManifest | VERIFIED | src/index.ts:57-71 |
| 20  | ManifestEntry passed to updateManifest includes commits | VERIFIED | src/index.ts:64-70 (commits unconditionally in entry) |
| 21  | E2E test: fresh + second deploy, second contains only new commits | VERIFIED | __tests__/pipeline-metadata.test.ts E2E-1, E2E-2 |
| 22  | Full vitest suite passes | VERIFIED | PASS (78) FAIL (0) |
| 23  | dist/index.js rebuilt with extractCommits | VERIFIED | dist/index.js exists, `grep -c extractCommits` = 3 |

**Score:** 23/23 truths verified

### Required Artifacts

| Artifact | Status | Notes |
| -------- | ------ | ----- |
| src/types.ts (CommitInfo, schema union) | VERIFIED | All 3 type changes present |
| src/metadata-extractor.ts | VERIFIED | execFile, format string, cap, fallback, fetch-depth hint, shallow detection all present |
| __tests__/metadata-extractor.test.ts | VERIFIED | 7 it() blocks, real git fixtures |
| src/manifest-manager.ts | VERIFIED | schema 1\|2 read, schema 2 write |
| src/index.ts | VERIFIED | extractCommits wired between read and update |
| __tests__/pipeline-metadata.test.ts | VERIFIED | 4 E2E it() blocks |
| dist/index.js | VERIFIED | rebuilt, contains extractCommits |

### Key Link Verification

| From | To | Status |
| ---- | -- | ------ |
| metadata-extractor.ts -> node:child_process execFile | WIRED |
| metadata-extractor.ts -> types.ts CommitInfo | WIRED |
| index.ts -> metadata-extractor.ts (extractCommits import + call) | WIRED |
| index.ts -> manifest-manager.ts (entry with commits) | WIRED |
| manifest-manager.ts -> types.ts (Manifest schema 1\|2) | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Status |
| -------- | ---- | ------ | ------ |
| ManifestEntry.commits in versions.json | commits array | extractCommits(sourceRepoDir, sha, previousSha) — real `git log` shell-out | FLOWING (verified end-to-end by pipeline-metadata.test.ts E2E-1..E2E-4 against real fixture repos) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite green | `npx vitest run` | PASS (78) FAIL (0) | PASS |
| dist bundle contains extractCommits | `grep -c extractCommits dist/index.js` | 3 | PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| META-01 | Extract commit history between current and previous deploy of same version | SATISFIED | previousSha lookup by versionSlot (index.ts:58-59); `previousSha..currentSha` range (metadata-extractor.ts:88-89); E2E-2, E2E-4 |
| META-02 | sha + author name/email + message + timestamp per commit | SATISFIED | CommitInfo type (types.ts:28-34); FORMAT string captures all 5 fields |
| META-03 | All metadata stored in manifest, available downstream | SATISFIED | entry.commits flows into updateManifest -> writeManifest; E2E tests round-trip via real readManifest |
| MNFST-02 | Each entry has version, ref, sha, timestamp, commit history since last deploy | SATISFIED | ManifestEntry shape + index.ts:64-70 |
| MNFST-03 | Author info + commit messages per included commit | SATISFIED | CommitInfo carries author_name/email/message; preserved through pipeline |

No orphaned requirements.

### Anti-Patterns Found

None. Verified absence of `|| true`, `2>/dev/null`, empty catch swallow in metadata-extractor.ts, manifest-manager.ts, and the new index.ts wiring. The single `try/catch` in metadata-extractor's force-push fallback rethrows non-matching errors and the matching branch is itself a value-driven retry, not a swallow. The shallow-vs-force-push branch uses a real precondition (`.git/shallow` existence) to disambiguate per D-11.

### Human Verification Required

None. All goal criteria are mechanically verifiable and verified by the fixture-based test suite.

### Gaps Summary

No gaps. Phase 2 delivers the full git-metadata data path: type contract, single-enforcer extractor with range selection / 100-cap / force-push fallback / shallow-clone loud-fail, schema 1->2 reader compatibility, schema 2 writer, unconditional pipeline wiring threading sourceRepoDir captured before worktree prep, end-to-end fixture proof across first deploy / incremental / legacy schema 1 / multi-slot, and a rebuilt dist bundle. 78/78 tests green.

---

_Verified: 2026-04-06_
_Verifier: Claude (gsd-verifier)_
