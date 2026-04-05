# Technology Stack

**Project:** gh-pages-multiplexer
**Researched:** 2026-04-05

## Recommended Stack

### Language and Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | 6.x | Primary language | GitHub's official Action template uses TypeScript. Type safety matters for git operations where a wrong string silently corrupts a branch. |
| Node.js 20 | 20.x (action runtime) | Action execution runtime | `runs.using: node20` is the current default for GitHub Actions runners. Node 22 is being skipped entirely; Node 24 becomes default June 2026. Ship on node20 now, migrate to node24 when runner support stabilizes. |

**Confidence:** HIGH -- verified via GitHub changelog and npm registry.

### GitHub Action SDK

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @actions/core | 3.0.0 | Inputs, outputs, logging, secrets | Official toolkit. No alternative exists. Provides `getInput()`, `setOutput()`, `setFailed()`, `info()`, `warning()`. |
| @actions/exec | 3.0.0 | Running shell commands (git) | Official toolkit for spawning processes. Provides stdout/stderr capture, exit code handling. Use this over child_process directly. |
| @actions/io | 3.0.2 | File system operations (cp, mv, mkdir) | Official toolkit. Handles cross-platform path concerns. |
| @actions/github | 9.0.0 | GitHub API access (Octokit client) | Provides pre-authenticated Octokit instance from the workflow's GITHUB_TOKEN. Needed for API calls if we ever need them (e.g., Pages API). |

**Confidence:** HIGH -- versions verified via `npm view` on 2026-04-05.

### Git Operations

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @actions/exec (calling git CLI) | 3.0.0 | All git operations | Use `@actions/exec` to call the `git` binary directly. Git is guaranteed present on all GitHub Actions runners. This is simpler and more predictable than a wrapper library. |

**Why NOT simple-git (3.33.0):** simple-git is a fine library for application code, but in a GitHub Action we already have `@actions/exec` which provides process spawning with stdout/stderr capture. Adding simple-git means: (a) another dependency to bundle, (b) an abstraction layer over git that may hide error details we need, (c) behavior differences from the git CLI that users debug against. The git operations needed (checkout, add, commit, push, log, diff) are straightforward shell commands. Keep the dependency surface small.

**Why NOT isomorphic-git:** Pure JS git implementation. Impressive but unnecessary -- git is always available on runners. isomorphic-git has edge cases with large repos and authentication that the real git binary handles natively.

**Confidence:** HIGH -- this is the pattern used by peaceiris/actions-gh-pages and JamesIves/github-pages-deploy-action, the two most popular GH Pages deployment actions.

### Index Page Generation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Template literals (built-in) | N/A | HTML generation for index page | The index page is a single HTML file generated from manifest data. Template literals in TypeScript are sufficient. No template engine needed for one file. |

**Why NOT EJS/Eta/Nunjucks:** A template engine adds a dependency for generating a single HTML page. The index page structure is owned by this tool, not user-customizable (out of scope per PROJECT.md). TypeScript template literals with a builder function give us type-checked interpolation with zero dependencies. If we later want user-customizable templates, Eta (4.5.1, 3.5KB gzipped, TypeScript-native) would be the right choice.

**Why NOT a static site generator (Eleventy, etc.):** Massive overkill. We generate one HTML file from structured data. An SSG is for building entire sites from content files.

**Confidence:** HIGH -- architectural judgment call, not a library question.

### Navigation Widget

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vanilla JavaScript | N/A | Injected floating nav widget | The widget must be injected into arbitrary HTML pages. It must have zero dependencies, load the manifest via fetch, and render a version selector. Any framework or library would conflict with the host page's JS. Vanilla JS with a shadow DOM root isolates styles and prevents conflicts. |

**Why Shadow DOM:** The widget injects into pages we don't control. Without shadow DOM, our CSS affects the host page and vice versa. Shadow DOM provides style isolation. Browser support is universal (97%+ as of 2025).

**Confidence:** HIGH -- this is the standard approach for injected widgets (analytics tools, chat widgets, etc. all use this pattern).

### Bundling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @vercel/ncc | 0.38.4 | Bundle Action into single dist/index.js | Industry standard for GitHub Actions. Compiles TypeScript + all node_modules into a single file that gets committed to the repo. GitHub's official TypeScript Action template uses ncc. |

**Why NOT esbuild:** esbuild (0.28.0) is faster and more popular overall, but ncc is purpose-built for bundling Node.js CLI/Action code into a single file with all dependencies. It handles dynamic requires and Node.js built-ins correctly out of the box. The GitHub Actions ecosystem expects ncc. Build time is a one-time cost (seconds), not a hot path. Use the tool designed for the job.

**Why NOT tsup/rollup/webpack:** Same reasoning. These are general-purpose bundlers. ncc is the blessed tool for this specific use case.

**Confidence:** HIGH -- verified via GitHub's official typescript-action template.

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vitest | 4.1.2 | Unit and integration tests | Fast, TypeScript-native, ESM-first. Jest is the legacy choice; Vitest is the modern standard with compatible API. |

**Confidence:** MEDIUM -- Vitest is clearly the direction, but GitHub's official template still uses Jest. Either works; Vitest is the better DX choice for a new project.

### Development Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | 6.x | Type checking | Latest stable. |
| @github/local-action | latest | Local testing of Actions | Official GitHub tool to test actions locally without pushing to a workflow. Simulates the Actions runtime. |
| eslint | 9.x | Linting | Flat config format is now standard. |
| prettier | 3.x | Formatting | Opinionated formatting, no debates. |

**Confidence:** MEDIUM -- @github/local-action is relatively new; verify its maturity during phase 1.

## Manifest Format

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| JSON | N/A | Manifest file format | `manifest.json` at the root of gh-pages branch. JSON is natively parseable by the nav widget (fetch + JSON.parse), natively writable by Node.js, and human-readable. No schema language needed for v1; TypeScript interfaces define the shape. |

**Why NOT YAML:** The nav widget runs in browsers. YAML requires a parser library. JSON is free in every runtime.

**Confidence:** HIGH -- obvious choice for browser-consumable structured data.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | TypeScript | JavaScript | No type safety for complex git operations and manifest management |
| Language | TypeScript | Go/Rust (Docker action) | Docker actions are Linux-only and slower to start. JS/TS actions run natively on all runner OS. |
| Git operations | @actions/exec + git CLI | simple-git | Unnecessary abstraction; git CLI is available and well-understood |
| Git operations | @actions/exec + git CLI | isomorphic-git | Edge cases with large repos; git binary is always available |
| Template engine | Template literals | EJS/Eta | One file to generate; template engine is overkill |
| Template engine | Template literals | React SSR | Absurd complexity for one HTML page |
| Widget isolation | Shadow DOM | iframe | PROJECT.md explicitly rules out iframes |
| Bundler | @vercel/ncc | esbuild | ncc is purpose-built for Actions; esbuild needs more config for this use case |
| Testing | Vitest | Jest | Vitest is faster, TS-native, modern |
| Manifest format | JSON | YAML | Browser must parse manifest; JSON is free, YAML needs a library |

## Installation

```bash
# Core dependencies
npm install @actions/core@3 @actions/exec@3 @actions/io@3 @actions/github@9

# Dev dependencies
npm install -D typescript@6 @vercel/ncc@0.38 vitest@4 @types/node@20 eslint@9 prettier@3
```

## Project Structure

```
gh-pages-multiplexer/
  action.yml              # Action metadata (inputs, outputs, runs.using: node20)
  src/
    main.ts               # Action entry point
    deploy.ts             # Git operations: checkout gh-pages, copy build, commit, push
    manifest.ts           # Read/write/update manifest.json
    index-page.ts         # Generate index.html from manifest data
    widget.ts             # Nav widget JS source (gets injected into deployed pages)
    git.ts                # Thin wrapper around @actions/exec for git commands
    types.ts              # Shared TypeScript interfaces (Manifest, Version, etc.)
  dist/
    index.js              # ncc-compiled bundle (committed to repo)
  __tests__/
    deploy.test.ts
    manifest.test.ts
    index-page.test.ts
  widget/
    nav-widget.js         # Standalone vanilla JS widget (not bundled with action)
```

## Key Architectural Notes

1. **The Action and the Widget are separate artifacts.** The Action is a Node.js bundle that runs in CI. The widget is a standalone JS file that runs in browsers. They share the manifest schema but nothing else. Do not bundle them together.

2. **Git operations use @actions/exec, not a library.** Every git command is a function call to `exec.exec('git', [...args])` with stdout capture. This keeps operations transparent and debuggable.

3. **The manifest is the single source of truth.** The index page and widget are both derived from `manifest.json`. The manifest is written by the Action during deployment and read by the widget at browse-time.

4. **Node 20 today, Node 24 migration path.** Ship with `runs.using: node20`. When GitHub makes node24 default (June 2026), update action.yml. The code itself does not depend on Node version specifics.

## Sources

- [GitHub Actions Toolkit](https://github.com/actions/toolkit) -- official SDK
- [GitHub TypeScript Action Template](https://github.com/actions/typescript-action) -- official starter
- [Node 20 Deprecation Timeline](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) -- node20 to node24 migration
- [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) -- reference implementation for gh-pages deployment
- [JamesIves/github-pages-deploy-action](https://github.com/JamesIves/github-pages-deploy-action) -- reference implementation
- [@vercel/ncc](https://github.com/vercel/ncc) -- bundler for Actions
- [Eta template engine](https://eta.js.org/) -- if templates needed later
- npm registry (verified 2026-04-05) -- all version numbers
