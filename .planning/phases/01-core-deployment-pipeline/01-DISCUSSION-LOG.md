# Phase 1: Core Deployment Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 01-core-deployment-pipeline
**Areas discussed:** Action packaging, Version naming, Concurrency strategy, Base path correction

---

## Action Packaging

### Action Type

| Option | Description | Selected |
|--------|-------------|----------|
| JavaScript action (Recommended) | Runs directly on runner via Node.js. Fastest startup, no container overhead. Best for git/file operations. | ✓ |
| Composite action | Shell scripts orchestrated by action.yml steps. Simpler but harder error handling. | |
| Docker action | Runs in container. Consistent environment but ~30s startup overhead. | |

**User's choice:** JavaScript action
**Notes:** None

### Language

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript (Recommended) | Type safety, better IDE support, compiled to JS for distribution. | ✓ |
| Plain JavaScript | No build step needed but loses type checking. | |

**User's choice:** TypeScript
**Notes:** None

---

## Version Naming

### Ref to Name Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Sanitize only (Recommended) | Replace invalid chars with hyphens. Predictable, reversible. | ✓ |
| Strip tag prefix | Remove 'v' prefix from semver tags. Cleaner but loses original ref. | |
| User always provides name | No auto-derivation, explicit input required. | |

**User's choice:** Sanitize only
**Notes:** None

### Override Input

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, optional override (Recommended) | Auto-derive by default, accept explicit 'version' input. | |
| No, always auto-derive | Simpler but less flexible. | ✓ |

**User's choice:** No, always auto-derive
**Notes:** Keeps interface minimal — version name is deterministic from git ref

---

## Concurrency Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch-rebase-push retry (Recommended) | Each deploy fetches, adds, pushes with retry on conflict. Self-healing. | |
| GitHub concurrency groups | Use GitHub's built-in concurrency key to serialize deployments. | ✓ |
| Both (belt and suspenders) | Recommend concurrency groups + implement retry as fallback. | |

**User's choice:** GitHub concurrency groups
**Notes:** None

---

## Base Path Correction

### Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Inject <base href> tag (Recommended) | Insert base tag into HTML head. Simple, handles most cases. | ✓ |
| Rewrite URLs in HTML | Parse and rewrite src/href attributes. More thorough but fragile. | |
| Document only, don't fix | Tell users to configure their build tool. Zero magic. | |

**User's choice:** Inject <base href> tag
**Notes:** User requires a configuration option to also allow full URL rewriting in HTML as an opt-in mode

### Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All HTML files (Recommended) | Inject into every .html file. Consistent behavior. | ✓ |
| Only index.html | Simpler but breaks direct links to sub-pages. | |

**User's choice:** All HTML files
**Notes:** None

---

## Claude's Discretion

- Manifest JSON schema design
- Build/bundle tooling choice
- Git operations implementation
- Error messaging and logging
- Action input validation

## Deferred Ideas

None — discussion stayed within phase scope
