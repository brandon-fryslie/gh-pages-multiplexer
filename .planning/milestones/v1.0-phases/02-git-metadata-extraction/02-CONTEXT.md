# Phase 2: Git Metadata Extraction - Context

**Gathered:** 2026-04-06 (assumptions mode, --auto)
**Status:** Ready for planning

<domain>
## Phase Boundary

At deploy time, extract the git commit history that went into this deployment (commits between the previous deployment of the same version slot and the current deployment SHA) and persist it inside the manifest entry. Each commit record includes SHA, author name, author email, message, and ISO timestamp. The manifest (versions.json) remains the single source of truth — no separate metadata files. Index page rendering and widget consumption are out of scope (Phases 3 and 4).
</domain>

<decisions>
## Implementation Decisions

### Storage location
- **D-01:** Extend the existing `ManifestEntry` type with a `commits: CommitInfo[]` field. Do NOT introduce a separate metadata file (META-03 / one-source-of-truth).
- **D-02:** Bump manifest schema from `1` to `2`. Reader accepts both `1` and `2` (forward-compat for any pre-existing gh-pages branches); writer always emits `2`.
- **D-03:** New `CommitInfo` type in `src/types.ts`: `{ sha: string; author_name: string; author_email: string; message: string; timestamp: string }` — `timestamp` is ISO 8601, `message` is the full commit message (subject + body, untrimmed), `sha` is the full 40-char SHA.

### Extraction strategy
- **D-04:** Use `git log` shelled out via `node:child_process.execFile` (no new dependency). The repo is already cloned in the source workdir during the action run, so commits are reachable.
- **D-05:** Range selection: if a previous manifest entry exists for the same `versionSlot`, log commits with `<previous.sha>..<current.sha>`. If no previous entry exists, log all commits reachable from `<current.sha>` capped at 100.
- **D-06:** Cap at 100 commits per deployment regardless of range (prevents pathological manifest size on first deploy of a long-history repo). When the cap is hit, the oldest commit retained is the cap-th; older commits are dropped silently with a `core.info` line in the action log.
- **D-07:** Use `git log --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e <range>` (fields separated by `\x1f`, records by `\x1e`) so commit messages with newlines parse cleanly. Then split by `\x1e`, then by `\x1f`.

### Pipeline integration
- **D-08:** New module `src/metadata-extractor.ts` exports `extractCommits(repoDir: string, currentSha: string, previousSha: string | null): Promise<CommitInfo[]>`. Pure-ish wrapper around git log with the range logic and 100-cap encoded in data.
- **D-09:** Integration point: `src/index.ts` calls `extractCommits` after `readManifest()` (to know the prior SHA) and before `updateManifest()`. The previous SHA comes from `manifest.versions.find(v => v.version === ctx.versionSlot)?.sha ?? null`. The result is folded into the new `ManifestEntry` as `commits`.
- **D-10:** Repo dir for `git log` is the *source* repo (where the action checked out the user's code), not the gh-pages worktree. The current process CWD at action start is the source repo — pass it explicitly so it's deterministic.

### Failure handling
- **D-11:** If `git log` fails (e.g., shallow clone missing history) the action FAILS LOUDLY with a clear message instructing the user to set `fetch-depth: 0` on `actions/checkout`. No silent fallback to empty commits[]. (single-source-of-truth + scripting-discipline.)
- **D-12:** If the previous SHA is no longer reachable (force-push rewrote history), fall back to "all commits reachable from current, capped at 100" — same as first-deployment path. Log an info line noting the fallback. This is the only acceptable fallback because the alternative (failing) would block all deployments after a force-push.

### Claude's Discretion
- Test fixtures: build a small temp git repo per test using execFile to commit fixture content; don't mock git.
- Exact wording of error messages.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Manifest (MNFST-02, MNFST-03) — schema additions
- `.planning/REQUIREMENTS.md` §Git Metadata (META-01, META-02, META-03) — extraction scope
- `.planning/ROADMAP.md` Phase 2 — success criteria

### Existing code (must read before planning)
- `src/types.ts` — `ManifestEntry`, `Manifest` definitions to extend
- `src/manifest-manager.ts` — schema version handling, `updateManifest()` semantics
- `src/index.ts` — pipeline wiring, where to insert extractCommits call
- `.planning/phases/01-core-deployment-pipeline/01-VERIFICATION-LIVE.md` — confirms manifest file is `versions.json` (not `manifest.json`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/manifest-manager.ts` `readManifest()` already returns the prior manifest in-memory inside the deploy flow — the previous SHA per version slot is one `.find()` away. No new I/O needed to discover it.
- `src/types.ts` is the single source for data contracts; extending `ManifestEntry` propagates types throughout the pipeline automatically.
- `src/index.ts` already has a fixed-order pipeline with the `[LAW:dataflow-not-control-flow]` annotation — extractCommits slots in as one more unconditional stage.

### Established Patterns
- Pure data transforms in modules, single I/O enforcer in `branch-manager.ts`. `metadata-extractor.ts` is the *one* exception — it shells out to git — but it touches the source repo (read-only), not the gh-pages branch, so it does not violate single-enforcer for the gh-pages I/O surface.
- Vitest test files live under `__tests__/` named `<module>.test.ts`. Tests build real fixture state (real git repos) rather than mocking — phase 1 set this convention, phase 2 should follow.
- Schema version field is the forward-compat seam (`Manifest.schema`). Bumping it is the canonical mechanism for additive shape changes.

### Integration Points
- Hook point 1: `src/index.ts` between `readManifest` and `updateManifest` calls — insert `extractCommits` and fold result into new `ManifestEntry`.
- Hook point 2: `src/types.ts` — add `CommitInfo` interface and the optional `commits?: CommitInfo[]` field on `ManifestEntry` (optional during read, populated on write so existing schema-1 entries continue to parse).
- Hook point 3: `src/manifest-manager.ts` — relax schema check to accept `1 | 2`, always emit `2` on write.

</code_context>

<specifics>
## Specific Ideas

- The 100-commit cap is informed by typical CI display needs and JSON size: 100 commits ≈ ~30KB per version entry; 50 versions ≈ 1.5MB manifest, still well under any practical gh-pages limit.
- Field separator approach (`\x1f` / `\x1e`) is the standard "git log porcelain that survives multi-line bodies" trick — same approach used by tools like git-cliff.

</specifics>

<deferred>
## Deferred Ideas

- Rendering the commit history (Phase 3 — Rich Index Page).
- Surfacing commit history in the navigation widget (Phase 4 — Navigation Widget; widget may show counts only).
- Author avatar URLs / GitHub profile links — Phase 3 can compute these from author email at render time; not stored in manifest.
- Co-authored-by parsing — out of scope; raw commit body is preserved so future phases can parse if needed.
- Conventional commit categorization — out of scope; explicitly listed as "Out of Scope" in REQUIREMENTS.md.

</deferred>

---

*Phase: 02-git-metadata-extraction*
*Context gathered: 2026-04-06 (assumptions mode, --auto)*
