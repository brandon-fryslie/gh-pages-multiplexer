# Milestones

## v1.0 Core Multi-Version Deployment (Shipped: 2026-04-06)

**Phases completed:** 5 phases, 12 plans
**Requirements:** 28/28 v1 requirements satisfied
**Tests:** 165/165 unit tests green
**Validation:** Live end-to-end deploy against brandon-fryslie/ghpm-validation, chrome-devtools-mcp UI verification, CLI + PR sticky comment exercised against real GitHub API
**Audit:** `.planning/milestones/v1.0-MILESTONE-AUDIT.md` — status PASS
**Timeline:** 2026-04-05 → 2026-04-06 (50 commits, 85,632 insertions across 81 files)

**Key accomplishments:**

1. Core deployment pipeline — versioned subdirectory placement on `gh-pages` with concurrent-run safety via fetch-rebase-retry through a git worktree (Phase 1)
2. Git metadata extraction with schema 2 manifest — per-version commit history (SHA, author, timestamp, message) captured at deploy time (Phase 2)
3. Auto-generated rich index page — pure-function renderer with inline light/dark CSS, mobile breakpoint, and html-validate + XSS payload gates (Phase 3)
4. Navigation widget — Shadow DOM isolated Web Component injected into every HTML file via marker-idempotent rewriter, runtime manifest fetch for version switching (Phase 4)
5. CLI adapter + PR sticky preview comments — `npx gh-pages-multiplexer deploy` shares a single `deploy()` core with the Action; PR comments use marker-based upsert (Phase 5)
6. Content-agnostic GitHub Action packaging — two-bundle Rollup (action + CLI), `action.yml` inputs, dist/ committed

**Validated requirements:** All 28 v1 requirements across DEPL, MNFST, INDX, NAVW, GHUB, META families.

**Test repo:** https://github.com/brandon-fryslie/ghpm-validation

---
