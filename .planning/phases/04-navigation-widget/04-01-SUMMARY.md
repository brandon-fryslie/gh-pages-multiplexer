---
phase: 04-navigation-widget
plan: 01
subsystem: widget-injector
tags: [widget, shadow-dom, injection, tdd]
requires:
  - "@actions/core (logging)"
provides:
  - "src/widget-injector.ts: getWidgetScriptTag(opts), injectWidgetIntoHtmlFiles(versionDir, opts), WIDGET_MARKER"
affects:
  - "Plan 04-02 will call injectWidgetIntoHtmlFiles from branch-manager"
tech-stack:
  added:
    - "Web Components custom element (gh-pm-nav) with Shadow DOM mode 'open'"
  patterns:
    - "Marker-comment idempotency (single source of truth for 'already injected')"
    - "Data-driven </body> -> </html> -> append+warn fallback chain"
    - "JSON.stringify + </ -> <\\/ escaping for script-context safety"
key-files:
  created:
    - src/widget-injector.ts
    - __tests__/widget-injector.test.ts
  modified: []
decisions:
  - "JSON.stringify alone is insufficient for script-tag escape; must additionally replace `</` with `<\\/` to neutralize </script> breakout"
  - "Buffer.equals is an instance method (not static) on this Node version; tests use buf1.equals(buf2)"
  - "@actions/core mocked at module level via vi.mock (ESM module namespace is non-configurable, vi.spyOn fails)"
metrics:
  duration: ~10min
  completed: 2026-04-06
---

# Phase 4 Plan 1: Widget Injector Summary

JSON.stringify-escaped, Shadow-DOM-rooted `<gh-pm-nav>` custom element delivered as a self-contained `<script>` tag with marker-comment idempotency, recursive *.html walk, and data-driven </body>/</html>/append fallback insertion -- 20 fixture-based tests covering every D-12..D-17 safety threat.

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Failing tests for widget-injector (RED) | 91e4de4 | __tests__/widget-injector.test.ts |
| 2 | Implement widget-injector (GREEN) | b653c61 | src/widget-injector.ts, __tests__/widget-injector.test.ts |

## must_haves Gates

All `must_haves.truths` from the plan frontmatter are satisfied:

- `getWidgetScriptTag` is pure, returns single `<script>...</script>` string
- `injectWidgetIntoHtmlFiles` walks recursively, mutates only *.html files, returns count
- Marker comment present in output
- Custom element `gh-pm-nav` with Shadow DOM `mode: 'open'`
- All three opts inlined via JSON.stringify (+ `</` escape)
- IIFE-wrapped, no top-level globals
- No external network references at injection time
- Idempotent: second pass returns 0, files byte-identical, exactly one marker
- Non-html files (css, js, json, svg, png) byte-identical after call
- </body> insertion preferred, </html> fallback, append+warn for malformed
- Zero-html dir returns 0 with `core.info` log, no throw
- fs errors propagate as thrown exceptions (no swallow, no || true)
- All tests use real fs fixtures in temp dirs; no fs mocks
- `npx vitest run __tests__/widget-injector.test.ts` -> 20/20 passed
- `npx tsc --noEmit` clean
- Full suite `npx vitest run` -> 133/133 passed (113 prior + 20 new)

## Architectural Laws Cited

- `[LAW:one-source-of-truth]` -- WIDGET_MARKER is the sole identifier for "already injected"
- `[LAW:single-enforcer]` -- this module owns widget template, marker, html injection rules; JSON.stringify is the sole escape mechanism
- `[LAW:dataflow-not-control-flow]` -- empty-html case is data-driven (`length === 0` -> 0), not a guarded skip; the </body>/</html>/append chain selects *position* by data while the insertion *operation* always runs; idempotency gate is data-driven content selection
- `[LAW:no-defensive-null-guards]` -- fs errors propagate, no swallow

## Threat Mitigations Verified

| Threat | Test |
|--------|------|
| T-04-01 (script breakout via currentVersion) | Test 8 -- evil `v1'"</script>` payload, asserts only one `</script>` in output |
| T-04-02 (double injection) | Test 12 -- byte-identity across two passes, exactly 1 marker |
| T-04-03 (corrupting non-html) | Test 13 -- css/js/json/svg/png all byte-identical post-call |
| T-04-04 (deploy crash on weird HTML) | Tests 15, 16 -- both fallback paths exercised |
| T-04-05 (host-page interference) | Tests 4, 5, 6 -- custom element + Shadow DOM 'open' + IIFE |
| T-04-06 (silent failure) | Tests 17, 18 -- info log on zero-html, throw on bad path |
| T-04-07 (external network at inject time) | Test 7 -- regex scan for src=, <link, http fetch/import |
| T-04-08 (global namespace pollution) | Test 6 -- IIFE wrap verified via regex |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSON.stringify alone does not escape `</script>` breakout**
- **Found during:** Task 2 verification (Test 8 failed)
- **Issue:** `JSON.stringify("v1'\"</script>")` produces `"v1'\"</script>"` -- forward slashes are NOT escaped, so the literal `</script>` substring still appears in the script source and breaks out of the script element.
- **Fix:** Wrapped JSON.stringify in a `safe()` helper that additionally replaces `</` with `<\/`. This is the canonical script-context-safe JSON serialization pattern. Applied to all five interpolated values (manifestUrl, indexUrl, currentVersion, SHADOW_CSS, SHADOW_HTML).
- **Files modified:** src/widget-injector.ts
- **Commit:** b653c61

**2. [Rule 1 - Bug] `Buffer.equals` is an instance method on this Node version**
- **Found during:** Task 2 verification (Test 13 failed with `Buffer.equals is not a function`)
- **Issue:** Test used `Buffer.equals(a, b)` (static form). Plan also specified static form. Static form does not exist on the runtime Node Buffer.
- **Fix:** Switched to `a.equals(b)` instance form.
- **Files modified:** __tests__/widget-injector.test.ts
- **Commit:** b653c61

**3. [Rule 3 - Blocking] vi.spyOn cannot redefine ESM module exports**
- **Found during:** Task 2 verification (Tests 15, 16, 17 failed with "Cannot redefine property")
- **Issue:** Plan instructed `vi.spyOn(core, 'warning')` and `vi.spyOn(core, 'info')`, but vitest in ESM mode cannot redefine module namespace exports. This is a known vitest limitation and is the pattern other tests in this repo (deploy.test.ts, branch-manager.test.ts) already work around.
- **Fix:** Added `vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }))` at the top of the test file (matching the existing project pattern), and switched assertions to `vi.mocked(core.warning)` / `vi.mocked(core.info)`. Per-test mock state cleared in `afterEach`.
- **Files modified:** __tests__/widget-injector.test.ts
- **Commit:** 91e4de4 (initial RED) + b653c61 (cleanup as part of GREEN)

## Key Decisions

- Script-context escape uses `JSON.stringify(v).replace(/<\//g, '<\\/')` -- single helper, applied uniformly
- Shadow DOM markup is built once as static const strings (`SHADOW_CSS`, `SHADOW_HTML`) outside the function -- pure function still deterministic, no per-call template construction
- Custom element class is defined inside the IIFE via a small `defineEl()` wrapper to keep the Babel/TS-emit-friendly `class extends HTMLElement` syntax inside the IIFE scope
- The `if (customElements.get('gh-pm-nav')) return;` runtime guard is a data-driven idempotency gate at the browser level (multiple injected scripts in one page from historic bugs do not double-register)

## Self-Check: PASSED

- src/widget-injector.ts: FOUND
- __tests__/widget-injector.test.ts: FOUND
- Commit 91e4de4: FOUND
- Commit b653c61: FOUND
- 133/133 tests pass; tsc clean
