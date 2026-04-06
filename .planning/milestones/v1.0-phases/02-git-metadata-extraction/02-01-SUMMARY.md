---
phase: 02-git-metadata-extraction
plan: 01
subsystem: metadata-extraction
tags: [types, git, metadata, extractor]
requires:
  - src/types.ts (ManifestEntry, Manifest)
provides:
  - CommitInfo type
  - extractCommits() producer
affects:
  - src/types.ts
  - src/metadata-extractor.ts
  - __tests__/metadata-extractor.test.ts
tech_stack:
  added:
    - node:child_process.execFile (git shell-out)
  patterns:
    - single-enforcer for git log invocation
    - dataflow-not-control-flow parseLog
key_files:
  created:
    - src/metadata-extractor.ts
    - __tests__/metadata-extractor.test.ts
  modified:
    - src/types.ts
decisions:
  - Detect shallow clone via .git/shallow to decide between force-push fallback (D-12) and loud shallow failure (D-11)
metrics:
  duration: ~10 min
  completed: 2026-04-06
  tasks: 3
  files: 3
requirements: [META-01, META-02]
---

# Phase 2 Plan 1: Git Metadata Types and Extractor Summary

CommitInfo data contract plus `extractCommits` git-log shell-out with 100-cap, force-push fallback, and shallow-clone loud failure — delivered as a single-path dataflow module with fixture-based tests using real git repos.

## What Was Built

- `src/types.ts`: added `CommitInfo` interface, optional `commits?: CommitInfo[]` on `ManifestEntry`, widened `Manifest.schema` to `1 | 2`.
- `src/metadata-extractor.ts`: `extractCommits(repoDir, currentSha, previousSha)` invokes `git log --format=%H\x1f%an\x1f%ae\x1f%aI\x1f%B\x1e -n 100 <range>` via `execFile`. Range is `previousSha..currentSha` on incremental, `currentSha` on first deploy. Parses records on `\x1e` / fields on `\x1f` so multi-line messages round-trip intact.
- Force-push fallback: when git reports the previous SHA as unknown/bad/invalid, retries with first-deploy range and logs via `core.info`.
- Shallow clone loud failure: before attempting fallback, checks for `.git/shallow`. If present and the prev SHA is unreachable, throws with "set fetch-depth: 0 on actions/checkout" hint rather than silently returning a truncated fallback (D-11 precedence over D-12 in the shallow case).
- `__tests__/metadata-extractor.test.ts`: 7 tests built on real fixture git repos (no mocks): first deploy, incremental range, 100-cap on both paths, force-push fallback, shallow-clone failure, multiline commit messages.

## Tasks & Commits

| # | Task | Commit |
|---|------|--------|
| 1 | Extend src/types.ts with CommitInfo and schema 1\|2 | 1b57e85 |
| 2 | Failing tests for metadata-extractor (RED) | 47b207c |
| 3 | Implement metadata-extractor (GREEN) | f6ccd76 |

## Verification

- `npx tsc --noEmit`: clean
- `npx vitest run __tests__/metadata-extractor.test.ts`: 7/7 pass
- `npx vitest run` (full suite): 72/72 pass
- `execFile` used (not `exec`); no shell interpolation on the revRange
- No `|| true`, no `2>/dev/null`, no empty catches — errors propagate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Parser dropped a ghost trailing record.**
- **Found during:** Task 3 GREEN
- **Issue:** First naive `parseLog` split on `\x1e` then filtered empty, yielding an extra empty record because git emits `\n` between `\x1e`-terminated records (the trailing `\n` survived as a 1-char record).
- **Fix:** Strip a leading `\n` per chunk, then filter records that lack a `FIELD_SEP` — structural test beats length heuristic.
- **Files modified:** src/metadata-extractor.ts

**2. [Rule 3 - Blocking] "Invalid revision range" not matched as unreachable.**
- **Found during:** Task 3 GREEN (Test 5 failed first)
- **Issue:** git emits `Invalid revision range A..B` for a bogus previousSha, not `unknown revision`. The regex didn't cover it, so the force-push fallback never triggered.
- **Fix:** Added `invalid revision range` to the unreachable-detection regex.
- **Files modified:** src/metadata-extractor.ts

**3. [Rule 2 - Critical] D-11 vs D-12 disambiguation for shallow clones.**
- **Found during:** Task 3 GREEN (Test 6 was silently falling back instead of failing loudly)
- **Issue:** The plan's D-11 (shallow = fail loud) and D-12 (unreachable prev = silent fallback) collide when both conditions hold at once: a shallow clone produces the same "bad revision" error as a force-push. Without disambiguation, Test 6 passes through the fallback branch and returns truncated history silently — exactly the `scripting-discipline` anti-pattern.
- **Fix:** Check `.git/shallow` before falling back. If shallow and prev SHA is unreachable, throw with the fetch-depth hint. This gives D-11 precedence when the evidence is definitive (a shallow marker file is ground truth) while still honoring D-12 for genuine force-pushes in full clones.
- **Files modified:** src/metadata-extractor.ts

## Key Decisions

- **Shallow-clone detection via `.git/shallow`**: chosen over stderr text matching because it's a structural signal owned by git itself, not a string-match that can drift across git versions. Logged as a new decision so Plan 02-02 and future phases treat it as load-bearing.
- **`filter(r => r.includes(FIELD_SEP))`** in parser: rejects garbage records by structural requirement (must have at least one field boundary) rather than by length heuristics — a dataflow-not-control-flow shape.

## Known Stubs

None. The module is fully implemented; Plan 02-02 will wire it into `src/index.ts` and extend the manifest writer to emit `schema: 2`.

## Self-Check: PASSED

- FOUND: src/types.ts (CommitInfo, commits?: CommitInfo[], schema: 1 | 2)
- FOUND: src/metadata-extractor.ts (extractCommits, execFile, fetch-depth: 0)
- FOUND: __tests__/metadata-extractor.test.ts
- FOUND commit: 1b57e85
- FOUND commit: 47b207c
- FOUND commit: f6ccd76
- Full test suite: 72/72 pass
