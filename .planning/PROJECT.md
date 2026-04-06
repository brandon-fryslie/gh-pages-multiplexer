# gh-pages-multiplexer

## What This Is

A content-agnostic GitHub Action (and CLI) that transforms GitHub Pages from single-deployment to multi-version. Builds accumulate in versioned subdirectories on the `gh-pages` branch instead of replacing each other. An auto-generated rich index page at the root presents a timeline of all deployed versions with per-version commit history, and a Shadow-DOM-isolated floating navigation widget injected into every HTML file lets users switch versions or return to the index without leaving the page. Concurrent deployments are safe via fetch-rebase-retry inside a git worktree. PR workflows get sticky preview comments automatically.

## Core Value

Every deployment is preserved and browsable — users can access any version of their GitHub Pages site through a single, well-designed index, and authors can preview PRs at stable URLs without trampling production.

## Current State

Shipped v1.0 (2026-04-06). Consumable as `uses: brandon-fryslie/gh-pages-multiplexer@v1` or `npx gh-pages-multiplexer deploy`. Two-bundle Rollup build committed to `dist/`. 165/165 unit tests green. Live-validated end-to-end against `brandon-fryslie/ghpm-validation` (real GH deploy, chrome-devtools-mcp UI checks, CLI path, PR sticky comment). 28/28 v1 requirements satisfied. Audit report: `.planning/milestones/v1.0-MILESTONE-AUDIT.md` (status PASS).

## Requirements

### Validated

- ✓ Versioned subdirectory deployment preserving history — v1.0 (DEPL-01/02/03)
- ✓ Base path correction via `<base href>` injection — v1.0 (DEPL-04)
- ✓ Concurrent-run safety (fetch-rebase-retry in worktree) — v1.0 (DEPL-05)
- ✓ JSON manifest as single source of truth, atomically committed with version content — v1.0 (MNFST-01/04)
- ✓ Schema 2 manifest with per-version commit history (SHA, author, timestamp, message) — v1.0 (MNFST-02/03, META-01/02/03)
- ✓ Auto-generated index page with timeline, per-version commit history, light/dark/mobile — v1.0 (INDX-01..06)
- ✓ Floating navigation widget with Shadow DOM isolation and runtime manifest fetch — v1.0 (NAVW-01..05)
- ✓ GitHub Action packaging with standard inputs and runner env — v1.0 (GHUB-01/02/03)
- ✓ CLI fallback `npx gh-pages-multiplexer deploy` — v1.0 (GHUB-04)
- ✓ PR sticky preview comments via marker-based upsert — v1.0 (GHUB-05)

### Active

_(none — planning next milestone)_

### Out of Scope

- iframe-based version embedding — injected nav is more generic and reliable
- Preview thumbnails/screenshots — high complexity, low value for v1
- Custom themes/branding for index page — sensible defaults first
- Automatic changelog generation beyond commit messages — raw git data suffices
- Build step integration — content-agnostic, deploys pre-built output only
- Authentication/access control — GitHub Pages is public
- Multi-repo aggregation — not a documentation platform
- Framework-specific plugins — content-agnostic is the moat

## Context

- 81 files, ~85K LOC (includes dist bundles and node_modules lockfile deltas)
- TypeScript, Rollup two-bundle build (action + CLI), Vitest, picomatch, html-validate, @actions/core, @actions/github
- Core architecture: pure functions for rendering/manifest/injection, single-enforcer git I/O in `branch-manager`, adapter pattern splitting Action (`src/index.ts`) and CLI (`src/cli.ts`) over shared `deploy()` in `src/deploy.ts`
- Marker-idempotency pattern reused across widget injection and PR comment upsert

## Constraints

- **Platform**: GitHub Actions runners (Linux, git, GITHUB_TOKEN)
- **Content-agnostic**: No assumptions about deployed page structure beyond static HTML/CSS/JS
- **Branch-based**: All versioned content and the index live on the target branch
- **No external services**: Everything self-contained on `gh-pages`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Injected nav widget over iframes | Iframes unreliable across diverse page content; injected nav is generic | ✓ Good — v1.0 shipped, widget non-intrusive with Shadow DOM |
| Manifest as single source of truth | Single file tracks all versions; index rebuilds from it; widget loads it dynamically | ✓ Good — schema 2 stable, reader accepts 1|2 for forward compat |
| Git metadata extracted at deploy time | All rich data comes from the repo itself, no manual caller input | ✓ Good — `extractCommits` producer lands history in manifest atomically |
| Rollup TS plugin outDir override | Keep tsconfig.json as source of truth while targeting ./dist | ✓ Good |
| `sanitizeRef` structural split-and-drop of `..` | Structural mitigation beats reject-list regex | ✓ Good — no path-traversal holes |
| `content-placer` uses `node:fs/promises` not `@actions/io` | Keeps unit tests runnable without Actions runtime | ✓ Good |
| Manifest reader accepts schema 1\|2, writer emits 2 | Forward-compat without dual-write | ✓ Good |
| `renderIndexHtml` derives footer timestamp from manifest | Preserves pure-function contract | ✓ Good — enabled deterministic tests |
| Extracted `deploy()` byte-for-byte into `src/deploy.ts` | Single-enforcer pipeline shared by Action + CLI adapters | ✓ Good — variability-at-edges, no drift |
| Two-bundle Rollup (action + CLI) | Distinct entrypoints, shared core | ✓ Good |
| Marker-based upsert for PR comments and widget injection | One idempotency pattern across both integration seams | ✓ Good — reused convention |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-04-06 after v1.0 milestone*
