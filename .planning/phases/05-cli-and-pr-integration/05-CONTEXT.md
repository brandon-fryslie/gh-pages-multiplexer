# Phase 5: CLI and PR Integration - Context

**Gathered:** 2026-04-06 (assumptions mode, --auto)
**Status:** Ready for planning

<domain>
## Phase Boundary

Two narrow capabilities landing on top of the already-complete pipeline:
1. **CLI**: `npx gh-pages-multiplexer deploy [--flags]` invokes the exact same deploy pipeline from any CI environment (not just GitHub Actions runners).
2. **PR sticky comment**: When the action runs in a `pull_request` context, after successful deploy, upsert a single comment on the PR with the preview URL. Idempotent across subsequent runs of the same PR.

Out of scope: CLI subcommands beyond `deploy`, PR comment customization, deploy previews for non-PR workflow runs.
</domain>

<decisions>
## Implementation Decisions

### CLI architecture
- **D-01:** The CLI is a **second entry point into the exact same `deploy(config)` function** used by the Action. Same pipeline, different input adapter. No fork in the implementation. (one-type-per-behavior / variability at edges.)
- **D-02:** New file `src/cli.ts` with a `#!/usr/bin/env node` shebang. Its job: parse argv + env vars into the existing `DeployConfig` type, call `deploy(config)`, exit with the right code. It imports the same `deploy()` that the Action's entry point imports.
- **D-03:** Refactor note: the current `src/index.ts` mixes "read from @actions/core + GITHUB_* env" with "call the pipeline." Extract the pipeline call into `src/deploy.ts` exporting `async function deploy(config: DeployConfig): Promise<DeployResult>` — pure-ish (still does I/O via branch-manager, but takes all config explicitly). `src/index.ts` becomes the Action adapter (parse from @actions/core, call deploy, handle core.setOutput/setFailed). `src/cli.ts` becomes the CLI adapter (parse from argv/env, call deploy, handle process.exit + console output).
- **D-04:** CLI flags mirror action.yml inputs one-to-one. Use a minimal flag parser — no new dependency; hand-rolled `parseArgs` from `node:util` (built in). Example: `npx gh-pages-multiplexer deploy --source-dir=dist --target-branch=gh-pages --ref=refs/tags/v1.0.0 --repo=owner/name`.
- **D-05:** CLI reads GitHub token from `$GITHUB_TOKEN` (or `$GH_TOKEN` as fallback — matches `gh` CLI convention). If absent, prints a clear error mentioning both env vars and exits 2 (config error). Does NOT read an `--token` flag because tokens in argv end up in shell history.
- **D-06:** CLI exit codes: `0` success · `1` deployment failure (fetch/rebase/push, git errors, etc.) · `2` configuration error (missing inputs, bad flags). Matches UNIX convention.

### Packaging
- **D-07:** Add `"bin": { "gh-pages-multiplexer": "./dist/cli.js" }` to `package.json` so `npx gh-pages-multiplexer deploy ...` works after installation or via npx-from-git. The CLI bundle is rolled up as a second rollup entry.
- **D-08:** Rollup config gains a second input (`src/cli.ts` → `dist/cli.js`) alongside the existing action entry (`src/index.ts` → `dist/index.js`). Both bundles share code via rollup's default chunking. **However**, to keep the Action bundle a single file for Actions consumption, each entry gets its own independent bundle (CJS, no code splitting). The duplication cost (~50KB × 2) is acceptable vs. the complexity of serving two CJS bundles with shared chunks to both consumers.
- **D-09:** `dist/cli.js` needs the same `dist/package.json` `"type":"commonjs"` shadow that Phase 1's live validation discovered (fix commit `6525551`). Already in place — applies to the whole dist directory, no extra work.

### PR sticky comment
- **D-10:** New module `src/pr-commenter.ts` exports `async function upsertPreviewComment(octokit, opts: { owner, repo, prNumber, previewUrl, version }): Promise<void>`. Uses GitHub REST API `GET /repos/.../issues/{pr}/comments` to search for a comment containing a magic marker, then `POST` to create or `PATCH` to update.
- **D-11:** **Marker:** HTML comment `<!-- gh-pages-multiplexer:preview -->` embedded at the start of the comment body. Single source of truth for "which comment do I update?" — same idempotency pattern as the widget marker (D-12 in Phase 4).
- **D-12:** Comment body format (markdown):
  ```
  <!-- gh-pages-multiplexer:preview -->
  ### 📦 Preview deployed

  **Version:** `{version}`
  **Preview:** {previewUrl}

  _Updated at {ISO timestamp}_
  ```
- **D-13:** Use `@actions/github` (already a transitive dep via `@actions/core`? — if not, add it — it's the standard `octokit` wrapper for Actions and is already how most Actions call the API). Detects PR number from `github.context.payload.pull_request.number`.
- **D-14:** Commenting only fires when **all** of:
  - `github.context.eventName === 'pull_request'` (or `pull_request_target`)
  - `github.context.payload.pull_request.number` is present
  - The deploy succeeded (exception thrown anywhere earlier short-circuits the commenter — failure path never tries to post a comment about a failed deploy)
  - The caller has `pull-requests: write` permission. If the API returns 403, log a clear warning that the workflow needs `permissions: pull-requests: write` but DO NOT fail the deploy — the deploy itself succeeded, the comment is an enhancement.
- **D-15:** CLI never posts comments — only the Action adapter has access to GitHub context and triggers `upsertPreviewComment`. The CLI is fire-and-forget.

### Integration point
- **D-16:** `src/index.ts` (Action adapter), after `deploy(config)` returns successfully and before reporting outputs, checks PR context and calls `upsertPreviewComment` when applicable. Comment call wrapped in a try/catch that logs the error and continues — deploy already succeeded.
- **D-17:** `previewUrl` construction: `https://{owner}.github.io/{repo}/{version}/` — matches the actual deployed path. For custom domains (CNAME present in `versionSlot`/`pages-branch`), use the configured domain (read from CNAME file if present) — defer custom-domain complexity as a FOLLOW-UP (log the default URL even on custom domains; real custom-domain CNAME handling lives in a deferred ticket).

### Failure handling
- **D-18:** CLI errors exit with non-zero and print a single stderr line with the error message. No stack trace by default; `--debug` flag (or `DEBUG=1` env) prints the full stack.
- **D-19:** PR commenter errors are logged as warnings and swallowed at the top of the Action adapter — BUT only at that boundary, and with a clear log line including the error message. This is a deliberate, bounded, documented exception to the "no swallowed errors" rule because the comment is genuinely optional and the deploy has already succeeded.

### Out of scope (this phase)
- CLI `list` / `delete` / `alias` subcommands (v2 VMGT-02/03)
- PR comment customization (templates, strings) — hard-coded for v1
- Non-PR workflow preview comments (issues, discussions) — out of scope
- Custom-domain CNAME-aware preview URLs — follow-up ticket

### Claude's Discretion
- Exact error message wording
- `parseArgs` help text format
- Whether to add `--version` / `--help` flags (recommended yes, trivial)
</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §GitHub Integration (GHUB-04, GHUB-05)
- `.planning/ROADMAP.md` Phase 5

### Existing code (must read before planning)
- `src/index.ts` — current Action entry; will be split into Action adapter + shared `deploy()`
- `src/types.ts` — `DeployConfig` is the shared interface both adapters target
- `src/branch-manager.ts` — gh-pages I/O (unchanged by this phase)
- `package.json` — `bin` field, dependencies
- `rollup.config.ts` — second entry point
- `.planning/phases/01-core-deployment-pipeline/01-VERIFICATION-LIVE.md` — dist/package.json fix is a prerequisite, already landed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DeployConfig` already contains every field needed by both adapters — no new type gymnastics.
- `@actions/core` and `@actions/github` (standard Action deps) provide `info`/`warning`/`setFailed`/`getInput` and the REST client. `@actions/github` is the canonical way to hit the GitHub API from Actions.
- Phase 1 validation already landed the `dist/package.json` CJS shadow — works for `dist/cli.js` too with zero extra config.

### Established Patterns
- `[LAW:variability-at-edges]`: pipeline core stays fixed, adapters handle the CI-specific quirks. This phase is the canonical example of that law — same `deploy()` behind two different adapters.
- `[LAW:one-type-per-behavior]`: Action and CLI do not become two deploy implementations. They differ ONLY in how they gather `DeployConfig`.
- Tests build real fixtures (real git repos, real HTTP servers where relevant). For `pr-commenter.ts`, mock the octokit client (the only reasonable approach — hitting real GitHub API from tests is brittle). Use a light mock with method counts, not a full recording.

### Integration Points
- Hook 1: Extract `deploy(config)` into `src/deploy.ts` (behavior unchanged — just moved)
- Hook 2: New `src/cli.ts` with `#!/usr/bin/env node` + `parseArgs` + call `deploy()`
- Hook 3: New `src/pr-commenter.ts` with `upsertPreviewComment()`
- Hook 4: `src/index.ts` adds post-deploy PR check + commenter call
- Hook 5: `rollup.config.ts` second input, `package.json` bin field + (if needed) `@actions/github` dep
- Hook 6: Tests: `__tests__/cli.test.ts` (argv/env parsing → config), `__tests__/pr-commenter.test.ts` (upsert semantics with mock octokit), E2E test updating pipeline test to cover the split

</code_context>

<specifics>
## Specific Ideas

- `parseArgs` from `node:util` (stable since Node 18.11) is the right tool here — zero dependency, good enough for a narrow flag set.
- The marker-based upsert pattern is the SAME design as the widget injection marker — both are "exactly one of these per target, find-by-marker." That repetition is a strong signal: idempotent-by-marker should probably be a reusable helper in a future cleanup phase. Not now — two uses is not yet a pattern.
- CLI shebang + `package.json` bin is the whole of "npx-invocable binary" — no wrappers, no launchers.

</specifics>

<deferred>
## Deferred Ideas

- Custom-domain CNAME-aware preview URLs → follow-up ticket
- CLI subcommands: `list`, `delete`, `alias` → v2 (VMGT-02/03)
- CLI-driven PR comment (for non-Action CIs) → would require separate auth story, not worth v1
- Comment templating / customization → v2
- Status checks API (marking PR as "preview ready") → v2
- Removing preview comment on PR close → follow-up

</deferred>

---

*Phase: 05-cli-and-pr-integration*
*Context gathered: 2026-04-06 (assumptions mode, --auto)*
