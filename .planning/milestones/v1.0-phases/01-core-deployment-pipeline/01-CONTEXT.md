# Phase 1: Core Deployment Pipeline - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy any static site into a versioned subdirectory on the gh-pages branch without destroying previous deployments. The tool is packaged as a GitHub Action from day one. A JSON manifest at the gh-pages root tracks every deployed version. Concurrent deployments are handled via GitHub concurrency groups.

</domain>

<decisions>
## Implementation Decisions

### Action Packaging
- **D-01:** JavaScript action using Node 20 runtime (`runs.using: node20`)
- **D-02:** Source written in TypeScript, compiled and bundled to `dist/index.js` for distribution
- **D-03:** Uses `@actions/core`, `@actions/exec`, `@actions/io` from the Actions toolkit

### Version Naming
- **D-04:** Version subdirectory name is always auto-derived from the git ref by sanitizing invalid filesystem characters (replacing `/`, `\`, `:`, etc. with hyphens)
- **D-05:** No explicit version name override input — the name is deterministic from the ref. Users who want custom names should name their branch/tag accordingly
- **D-06:** Examples: `refs/tags/v2.1.0` → `v2.1.0/`, `refs/heads/feature/auth` → `feature-auth/`, `refs/pull/42/merge` → `pr-42/`

### Concurrency Strategy
- **D-07:** Concurrency is handled by GitHub's built-in concurrency groups, not by the action itself
- **D-08:** Documentation recommends users add `concurrency: { group: gh-pages-deploy, cancel-in-progress: false }` to their workflow to serialize deployments

### Base Path Correction
- **D-09:** Inject `<base href="/repo-name/version/">` into the `<head>` of all HTML files in the deployed directory by default
- **D-10:** Provide a configuration option to enable full URL rewriting in HTML (rewriting `src`, `href`, and similar attributes) for users whose sites use absolute paths that `<base href>` doesn't fix
- **D-11:** Apply base path correction to all `.html` files, not just `index.html`

### Claude's Discretion
- Manifest JSON schema design (fields, format, extensibility) — must satisfy MNFST-01 through MNFST-04 and support downstream phases (metadata in Phase 2, index display in Phase 3)
- Build/bundle tooling choice (ncc, esbuild, or similar)
- Git operations implementation details (fetch, checkout, commit, push mechanics)
- Error messaging and logging approach
- Action input validation

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above and in the following project files:

### Project requirements
- `.planning/REQUIREMENTS.md` — Full v1 requirement definitions (DEPL-01 through DEPL-05, MNFST-01, MNFST-04, GHUB-01 through GHUB-03)
- `.planning/ROADMAP.md` §Phase 1 — Phase goal, success criteria, requirement mapping
- `.planning/PROJECT.md` — Core value, constraints, key decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — Phase 1 establishes the foundational patterns

### Integration Points
- GitHub Actions runtime environment (Linux runners, GITHUB_TOKEN, git available)
- gh-pages branch as deployment target
- Manifest JSON file at gh-pages root (consumed by Phase 2, 3, and 4)

</code_context>

<specifics>
## Specific Ideas

- Base path correction must have an opt-in URL rewriting mode beyond the default `<base href>` injection, for sites with absolute paths
- Concurrency is the user's responsibility via workflow configuration, not built into the action — keeps the action simple and composable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-core-deployment-pipeline*
*Context gathered: 2026-04-05*
