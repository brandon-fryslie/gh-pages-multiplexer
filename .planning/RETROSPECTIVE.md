# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Core Multi-Version Deployment

**Shipped:** 2026-04-06
**Phases:** 5 | **Plans:** 12 | **Commits:** 50 | **Timeline:** 2026-04-05 → 2026-04-06

### What Was Built

- Phase 1 (Core Deployment Pipeline): TypeScript/Rollup/Vitest scaffold, `action.yml`, `parseInputs`; pure-function pipeline modules (`ref-resolver`, `base-path`, `content-placer`, `manifest-manager`); `branch-manager` git worktree with fetch-rebase-retry; full `deploy()` wiring and dist bundle.
- Phase 2 (Git Metadata Extraction): `metadata-extractor` producer (`extractCommits`) shelling out to `git log` via `execFile`; schema 2 manifest writer with schema 1|2 reader; pipeline wired as unconditional Stage 3 sub-step; E2E proof of per-deploy commit history.
- Phase 3 (Rich Index Page): pure `renderIndexHtml(manifest, repoMeta)` with `escapeHtml` single-enforcer; inline light/dark CSS with mobile breakpoint; html-validate gate; XSS payload tests across version/commit-message/author surfaces; `writeIndexHtml` wired into the deploy commit alongside `versions.json`.
- Phase 4 (Navigation Widget): `widget-injector` producing a Web Component (`gh-pm-nav`) with open Shadow DOM; marker-idempotent rewriter with `</body> → </html> → append` fallback chain; `JSON.stringify` + `</` escaping for script-context safety; Stage 4.5 in the pipeline post-`placeContent`, pre-`commitAndPush`; E2E wiring tests.
- Phase 5 (CLI and PR Integration): byte-for-byte extraction of `deploy()` into `src/deploy.ts`; `src/cli.ts` CLI adapter using `node:util.parseArgs`; `src/pr-commenter.ts` marker-based sticky upsert via `@actions/github`; two-bundle Rollup (`dist/index.js` + `dist/cli.js`) with `bin` field; 165/165 tests green; full live validation.

### What Worked

- **Dataflow-first architecture paid off immediately.** Pure-function cores (renderer, manifest, widget injector, extractor) had near-trivial tests and zero test flake across 165 tests. Single-enforcer I/O in `branch-manager` meant git behavior lived in exactly one place.
- **Wave parallelization of plans within a phase.** Phase 1's three plans and Phase 3's three plans decomposed cleanly because contracts were declared up front in SUMMARY frontmatter (`requires`/`provides`).
- **Adapter pattern between Action and CLI.** Extracting `deploy()` byte-for-byte before building the CLI meant the CLI was a ~60 line adapter with no risk of drift from the Action. Variability lives at the edges; the core is invariant.
- **Live validation against a real repo caught bugs structural tests could not.** The `ghpm-validation` repo exercised the full push-to-real-GH, browse-with-chrome-devtools-mcp, open-PR loop. This is where the dist/package.json ESM issue and the shallow-clone `extractCommits` bug surfaced — both invisible to unit tests.
- **Marker-idempotency as a single reusable pattern.** Widget injection and PR sticky comment both use comment-marker upsert. One mental model, two integration seams, zero duplicated logic.

### What Was Inefficient

- **Shallow-clone bug in git metadata extraction was only caught by live validation.** `git log` on a `fetch-depth: 1` checkout silently returned partial history. Unit tests using `tmpdir` git repos always had full history. Lesson: integration boundaries (what the runner actually provides) need fixtures that mirror the runner.
- **`dist/package.json` ESM/CJS interop fix only surfaced in the real GH deploy.** Rollup config and `package.json` type field interact in ways local `node dist/index.js` does not exercise. Live validation was the only signal.
- **Some SUMMARY.md "bugs found" sections got auto-extracted as milestone "accomplishments"** by `gsd-tools milestone complete` (the CLI grabbed numbered list items without disambiguating section). Minor tooling friction; worked around by rewriting MILESTONES.md by hand.
- **Audit ceremony took a full pass to produce** because there was no running checklist of "requirement → code location → test → live evidence" being maintained during phases. A living traceability file would have compressed the audit from hours to minutes.

### Patterns Established

- **Marker-idempotent upsert at integration seams.** Any operation that rewrites an external artifact (HTML file, PR comment, file a future operation might re-touch) embeds a marker comment and replaces on match, appends on miss. One pattern, reused.
- **Single-enforcer git I/O.** All git interaction routes through `branch-manager`. Other modules are pure; they return data, they don't spawn processes. This is the architectural firewall that keeps the pure-function core pure.
- **Adapter pattern for multi-entrypoint tools.** Extract the core pipeline first, adapt second. The CLI and Action share one `deploy()`. New entrypoints (future: webhook handler? daemon?) plug in at the edge.
- **Live validation as a first-class milestone gate, not a post-ship nicety.** Real deploy + real browser + real PR is the only signal that integration-boundary bugs surface. Structural tests pass confidently on buggy bundlers.
- **Pure-function rendering with data-derived timestamps.** `renderIndexHtml` takes its timestamp from the manifest, not wall-clock, preserving determinism and testability.

### Key Lessons

1. **Live validation is load-bearing, not ceremony.** Two of the most impactful bugs in v1.0 (shallow-clone metadata, dist ESM interop) were invisible to the unit test suite no matter how thorough. Budget time for a real end-to-end loop against a real repo for every milestone.
2. **Structural tests are blind to bundler and runtime boundaries.** Tests that exercise source modules do not exercise the shipped bundle. Tests that use tmpdir git repos do not exercise GH's shallow checkouts. The bug lives where the test harness differs from production.
3. **Bugs cluster at integration seams.** Phase-internal bugs were caught by phase-internal tests. The bugs that escaped to live validation were all at seams: runner↔code, bundle↔runtime, action↔PR API. Invest validation effort proportionally at seams, not uniformly across modules.
4. **Pure-function cores compound in value.** Every phase that added a pure module (renderer, extractor, injector) made the next phase cheaper because the new module could be unit-tested in isolation and then wired through `branch-manager` with a single E2E test. Control-flow-heavy modules would have required integration tests at every step.
5. **Contracts-before-code via SUMMARY frontmatter `requires`/`provides`.** Declaring the interface before writing the implementation meant plans could execute in parallel and the integration step was mechanical. Skipping this scaffolding would have serialized the work.

### Cost Observations

- Sessions: roughly one per phase plus a final audit/validation session
- Notable: the live-validation session paid for itself twice over — two shipped-blocking bugs would have escaped to end users otherwise

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 12 | Established pure-core + single-enforcer-IO + live-validation-gate baseline |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 165 | green (all passing) | picomatch, html-validate (dev), @actions/core, @actions/github |

### Top Lessons (Verified Across Milestones)

1. (v1.0) Live validation at real integration boundaries catches bugs no structural test can.
2. (v1.0) Pure-function cores with single-enforcer I/O at the edges compound in value every phase.
