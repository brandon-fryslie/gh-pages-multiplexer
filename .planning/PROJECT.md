# gh-pages-multiplexer

## What This Is

A tool that transforms GitHub Pages from single-deployment to multi-version. Instead of each deployment replacing the previous one, builds accumulate in versioned subdirectories on the `gh-pages` branch. A rich index page at the root lets users browse, compare, and navigate between all deployed versions. An injected navigation widget in each version allows switching versions or returning to the index without leaving the page.

## Core Value

Every deployment is preserved and browsable — users can access any version of their GitHub Pages site through a single, well-designed index.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Versioned deployment: build output lands in a named subdirectory (derived from git tag or branch name) on the gh-pages branch, preserving all previous versions
- [ ] Manifest: a machine-readable manifest file tracks all deployed versions with metadata (ref name, commit SHA, timestamp, authors, commit messages since last deployment)
- [ ] Rich index page: auto-generated root index with timeline view, per-version commit history, version metadata, and modern UI design
- [ ] Injected navigation widget: a small floating UI element injected into each deployed version's pages, allowing users to switch versions or return to the index
- [ ] Configurable ref patterns: users specify which branches/tags trigger versioned deployments (e.g., `deploy_*` branches, `v*.*.*` tags) via glob or regex patterns
- [ ] GitHub Action integration: consumable as a GitHub Action step that replaces the repo's existing deploy-to-gh-pages step
- [ ] CLI fallback: optionally usable as a CLI tool invoked within a repo's existing GitHub Action workflow
- [ ] Git metadata extraction: at deploy time, automatically capture commit history, authors, timestamps, and diff stats from the repo for the index page

### Out of Scope

- iframe-based version embedding — unreliable across diverse page content, dropped in favor of injected nav + full navigation
- Preview thumbnails or screenshots of deployed versions — high complexity, low value for v1
- Custom themes or branding for the index page — sensible defaults first
- Automatic changelog generation beyond commit messages — keep it simple, use git data directly

## Context

- GitHub Pages serves static content from a branch (typically `gh-pages`) in a repo
- Existing workflows build static output and push it to `gh-pages`, replacing the previous deployment
- The tool must work with any static site generator output — it's content-agnostic
- The injected nav widget must be lightweight and non-intrusive; it dynamically loads the manifest to populate the version list
- The manifest is the single source of truth for what versions exist and their metadata

## Constraints

- **Platform**: Must work within GitHub Actions environment (Linux runners, git available, GitHub token for pushing)
- **Content-agnostic**: Cannot assume anything about the structure of the deployed pages beyond them being static HTML/CSS/JS
- **Branch-based deployment**: GitHub Pages reads from a branch — all versioned content and the index live on that branch
- **No external services**: Everything is self-contained in the repo's gh-pages branch — no databases, APIs, or external hosting

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Injected nav widget over iframes | Iframes don't work reliably for all page types; injected nav is more generic and reliable | -- Pending |
| Manifest as source of truth | Single file tracks all versions; index can be rebuilt from it; widget loads it dynamically | -- Pending |
| Git metadata extracted at deploy time | All rich data (commits, authors, timeline) comes from the repo itself, no manual input from callers | -- Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after initialization*
