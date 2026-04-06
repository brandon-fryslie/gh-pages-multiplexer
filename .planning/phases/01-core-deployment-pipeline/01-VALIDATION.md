---
phase: 1
slug: core-deployment-pipeline
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` (Wave 0 — does not exist yet) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | DEPL-02 | T-01-01 | Ref name sanitized against traversal | unit | `npx vitest run __tests__/ref-resolver.test.ts -t "sanitize"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | DEPL-03 | — | N/A | unit | `npx vitest run __tests__/ref-resolver.test.ts -t "pattern"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | GHUB-02 | T-01-02 | Input validation (source-dir required, base-path-mode enum) | unit | `npx vitest run __tests__/inputs.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | DEPL-01 | — | N/A | unit | `npx vitest run __tests__/content-placer.test.ts -t "preserves existing"` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | DEPL-04 | — | N/A | unit | `npx vitest run __tests__/base-path.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | MNFST-01 | — | N/A | unit | `npx vitest run __tests__/manifest-manager.test.ts -t "tracks"` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 2 | MNFST-04 | — | N/A | integration | `npx vitest run __tests__/deploy.test.ts -t "atomic"` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | DEPL-05 | — | N/A | unit | `npx vitest run __tests__/branch-manager.test.ts -t "retry"` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | GHUB-01 | — | N/A | smoke | `node dist/index.js` (mock env) | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 3 | GHUB-02 | — | N/A | unit | `npx vitest run __tests__/inputs.test.ts` | ❌ W0 → Plan 01 | ⬜ pending |
| 01-03-04 | 03 | 3 | GHUB-03 | — | N/A | integration | Manual — requires GitHub runner | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — test framework configuration
- [ ] `__tests__/ref-resolver.test.ts` — covers DEPL-02, DEPL-03
- [ ] `__tests__/inputs.test.ts` — covers GHUB-02 (created by Plan 01 Task 3)
- [ ] `__tests__/branch-manager.test.ts` — covers DEPL-05
- [ ] `__tests__/manifest-manager.test.ts` — covers MNFST-01, MNFST-04
- [ ] `__tests__/content-placer.test.ts` — covers DEPL-01
- [ ] `__tests__/base-path.test.ts` — covers DEPL-04
- [ ] `__tests__/deploy.test.ts` — covers MNFST-04 (atomic commit)
- [ ] Framework install: `npm install -D vitest@4`

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Works with GITHUB_TOKEN auth on real runner | GHUB-03 | Requires actual GitHub Actions runner environment | Create test workflow in a repo, trigger deployment, verify push succeeds |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
