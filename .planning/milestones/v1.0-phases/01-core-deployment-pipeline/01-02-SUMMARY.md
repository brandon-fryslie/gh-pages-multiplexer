---
phase: 01-core-deployment-pipeline
plan: 02
subsystem: pipeline-logic
tags: [typescript, vitest, picomatch, html-processing]
requires:
  - project-scaffold
  - type-contracts
provides:
  - ref-resolver
  - base-path-correction
  - content-placer
  - manifest-manager
affects:
  - src/ref-resolver.ts
  - src/base-path.ts
  - src/content-placer.ts
  - src/manifest-manager.ts
  - __tests__/ref-resolver.test.ts
  - __tests__/base-path.test.ts
  - __tests__/content-placer.test.ts
  - __tests__/manifest-manager.test.ts
tech-stack:
  added: []
  patterns: [tdd-red-green, pure-functions-with-fs-seam, idempotent-replace]
key-files:
  created:
    - src/ref-resolver.ts
    - src/base-path.ts
    - src/content-placer.ts
    - src/manifest-manager.ts
    - __tests__/ref-resolver.test.ts
    - __tests__/base-path.test.ts
    - __tests__/content-placer.test.ts
    - __tests__/manifest-manager.test.ts
  modified: []
decisions:
  - "sanitizeRef splits on '/' and drops '..' segments before rejoining with '-', eliminating the path-traversal class of bugs (T-01-01) structurally rather than relying on a reject-list regex"
  - "content-placer uses node:fs/promises (cp/rm/readdir) rather than @actions/io so the module is unit-testable in isolation without an Actions runtime"
  - "manifest updateManifest is a pure filter+prepend; it does not mutate the input, allowing callers to hold the previous manifest for rollback without defensive copies"
requirements:
  - DEPL-01
  - DEPL-02
  - DEPL-03
  - DEPL-04
  - MNFST-01
metrics:
  duration: ~7min
  tasks: 2
  files: 8
  tests: 45
  completed: 2026-04-06
---

# Phase 01 Plan 02: Pipeline Logic Modules Summary

Four pure-logic deployment pipeline modules (`ref-resolver`, `base-path`, `content-placer`, `manifest-manager`) implemented TDD-first, with 45 new vitest cases covering ref sanitization (including T-01-01 path-traversal defense), glob pattern filtering, HTML `<base href>` injection with fragment-link and existing-base-tag handling, URL rewriting mode, additive content placement that preserves sibling versions and root files (DEPL-01, Pitfalls 4+5), and idempotent manifest read/update/write with schema validation.

## What Was Built

- **`src/ref-resolver.ts`** (`sanitizeRef`, `matchesPatterns`, `resolveContext`) -- strips `refs/tags/`, `refs/heads/`, `refs/pull/N/merge` prefixes; splits on `/`, drops `..` segments, removes control chars / null bytes / filesystem-unsafe chars, collapses hyphens, rejects empty results. `matchesPatterns` uses `picomatch.isMatch`, with empty-list = match-all. `resolveContext` derives `DeploymentContext` including basePath for project sites (`/repo/slot/`), user sites (`*.github.io` -> `/slot/`), cname custom domains (`/slot/`), and explicit `basePathPrefix` override.
- **`src/base-path.ts`** (`injectBaseHref`, `rewriteUrls`) -- `injectBaseHref` replaces an existing `<base href>` if present (Pitfall 3), otherwise injects after `<head>`; always rewrites fragment-only `href="#x"` to `href="<filename>#x"` (Pitfall 2). Returns HTML unchanged if no `<head>` present. `rewriteUrls` rewrites `src="/..."` and `href="/..."` only (no `//`, no protocol-absolute, no already-relative).
- **`src/content-placer.ts`** (`placeContent`) -- `rm(target, {recursive, force})` the version slot (idempotent redeploy), `cp(sourceDir, target, {recursive})`, recursively walks the copied tree to apply `base-tag` or `rewrite` correction to every `.html` file, and `writeFile('.nojekyll', '', {flag: 'a'})` at workdir root. Sibling directories and root files are untouched (DEPL-01).
- **`src/manifest-manager.ts`** (`readManifest`, `updateManifest`, `writeManifest`) -- reads `versions.json` with ENOENT -> empty manifest, validates `schema === 1` and `versions` is an array (T-01-06). `updateManifest` is pure: filters out any existing entry with the same `version`, prepends the new one, returns a new `Manifest`. `writeManifest` writes 2-space indented JSON with trailing newline.

## Commits

| Task | Type | Hash    | Message |
|------|------|---------|---------|
| 1    | feat | fa32e1e | implement ref-resolver with sanitization and pattern matching |
| 2    | feat | 019f79c | implement base-path, content-placer, and manifest-manager |

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run __tests__/ref-resolver.test.ts` | PASS (21/21) |
| `npx vitest run __tests__/base-path.test.ts __tests__/content-placer.test.ts __tests__/manifest-manager.test.ts` | PASS (24/24) |
| Full suite `npx vitest run` | PASS (54/54) |
| `sanitizeRef` path traversal test (`refs/heads/../etc/passwd`) | PASS -- output never contains `..` or `/` |
| DEPL-01: existing version dirs + CNAME preserved across deploy | PASS |
| Idempotent redeploy (same versionSlot) | PASS -- stale content cleared |
| Manifest schema validation rejects `schema: 99` | PASS |
| `updateManifest` does not mutate input | PASS |

## Must-Haves Truths

- [x] Ref names are sanitized into safe, single-segment directory names
- [x] Ref patterns filter which refs proceed to deployment
- [x] HTML files get `<base href>` injection with fragment link fix
- [x] URL rewriting mode rewrites src and href attributes in HTML
- [x] Content is copied into version subdirectory without disturbing other directories
- [x] Manifest tracks all deployed versions and is read/written correctly

## Deviations from Plan

None -- plan executed exactly as written. TDD RED phase produced compile errors (modules didn't exist yet), which were resolved by the GREEN implementation pass in the same task (consistent with the plan's `tdd="true"` flow).

## Threat Model Status

- **T-01-01 (Tampering - ref sanitization)**: MITIGATED. `sanitizeRef` splits ref on `/`, drops `..` segments entirely, strips control/null/unsafe chars, rejects empty result. Tested with `refs/heads/../etc/passwd` and control-character inputs.
- **T-01-05 (Tampering - HTML injection)**: ACCEPTED per plan. Base path is derived from sanitized repo name + versionSlot; not user-controllable beyond the already-sanitized ref.
- **T-01-06 (Tampering - manifest schema)**: MITIGATED. `readManifest` throws if `schema !== 1` or `versions` is not an array.
- **T-01-07 (DoS via HTML glob)**: ACCEPTED per plan. Bounded by user's own build output.

No new threat surface introduced beyond what the plan's threat_model covered.

## Known Stubs

None. All four modules are fully implemented; Plan 03 will wire them into the git-based pipeline stages but nothing in these modules is placeholder.

## Authentication Gates

None encountered.

## Self-Check: PASSED

- `src/ref-resolver.ts`, `src/base-path.ts`, `src/content-placer.ts`, `src/manifest-manager.ts`: FOUND
- `__tests__/ref-resolver.test.ts`, `__tests__/base-path.test.ts`, `__tests__/content-placer.test.ts`, `__tests__/manifest-manager.test.ts`: FOUND
- Commits `fa32e1e`, `019f79c`: FOUND in git log
- `npx vitest run` full suite: 54/54 passing, exit 0
