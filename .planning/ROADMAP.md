# Roadmap: gh-pages-multiplexer

## Overview

This roadmap delivers a content-agnostic GitHub Action that transforms GitHub Pages from single-deployment to multi-version. The journey starts with reliable versioned deployment mechanics (the foundational invariant), layers in git metadata extraction, builds the user-facing index page and navigation widget as independent features, and finishes with CLI access and PR workflow integration.

## Milestones

- ✅ **v1.0 Core Multi-Version Deployment** — Phases 1-5 (shipped 2026-04-06)
- 📋 **v1.1 (next)** — TBD via `/gsd-new-milestone`

## Phases

<details>
<summary>✅ v1.0 Core Multi-Version Deployment (Phases 1-5) — SHIPPED 2026-04-06</summary>

- [x] Phase 1: Core Deployment Pipeline (3/3 plans) — versioned subdirectory deployment, manifest, concurrent-run safety
- [x] Phase 2: Git Metadata Extraction (2/2 plans) — per-version commit history, schema 2 manifest
- [x] Phase 3: Rich Index Page (3/3 plans) — auto-generated timeline UI, light/dark/mobile, XSS-hardened
- [x] Phase 4: Navigation Widget (2/2 plans) — Shadow DOM floating switcher injected into every HTML file
- [x] Phase 5: CLI and PR Integration (2/2 plans) — `npx` CLI adapter, PR sticky preview comments

Archived details: `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`, `.planning/milestones/v1.0-MILESTONE-AUDIT.md`, `.planning/milestones/v1.0-phases/`

</details>

### 📋 Next Milestone (TBD)

Run `/gsd-new-milestone` to plan the next milestone.

## Progress

| Phase                          | Milestone | Plans Complete | Status   | Completed  |
| ------------------------------ | --------- | -------------- | -------- | ---------- |
| 1. Core Deployment Pipeline    | v1.0      | 3/3            | Complete | 2026-04-05 |
| 2. Git Metadata Extraction     | v1.0      | 2/2            | Complete | 2026-04-06 |
| 3. Rich Index Page             | v1.0      | 3/3            | Complete | 2026-04-06 |
| 4. Navigation Widget           | v1.0      | 2/2            | Complete | 2026-04-06 |
| 5. CLI and PR Integration      | v1.0      | 2/2            | Complete | 2026-04-06 |
