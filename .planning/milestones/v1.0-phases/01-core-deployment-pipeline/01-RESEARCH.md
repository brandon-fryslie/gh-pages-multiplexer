# Phase 1: Core Deployment Pipeline - Research

**Researched:** 2026-04-05
**Domain:** GitHub Actions JavaScript Action + git-based versioned deployment
**Confidence:** HIGH

## Summary

Phase 1 delivers a GitHub Action (TypeScript, Node 24) that deploys a build directory into a versioned subdirectory on the gh-pages branch, preserving all previous deployments. The manifest (`versions.json`) at the gh-pages root is the single source of truth for what versions exist. Concurrency is the caller's responsibility via GitHub's built-in concurrency groups.

The official GitHub Actions TypeScript template has migrated to Node 24 and Rollup (away from ncc). Since Node 20 EOL is April 2026 and runners default to Node 24 starting June 2026, this project should ship with `runs.using: node24` from day one. The bundling toolchain follows the official template: Rollup with `@rollup/plugin-typescript`, `@rollup/plugin-node-resolve`, and `@rollup/plugin-commonjs`.

The critical technical risk in this phase is base path correction. The `<base href>` approach (D-09) has a known, documented problem: fragment/hash links (`#section`) become full URL requests instead of same-page navigation when a `<base>` tag is present. The implementation must account for this by rewriting `href="#..."` links to be absolute (e.g., `href="current-page.html#section"`) during the base-tag injection pass. The full URL rewriting mode (D-10) is the fallback for sites where `<base href>` is insufficient.

**Primary recommendation:** Follow the official GitHub Actions TypeScript template structure (Node 24, Rollup, ESM). Use `git worktree` for gh-pages branch operations. Implement a five-stage pipeline (Ref Resolver, Branch Manager, Manifest Manager, Content Placer, Branch Manager commit/push) where every stage always executes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** JavaScript action using Node 20 runtime (`runs.using: node20`)
- **D-02:** Source written in TypeScript, compiled and bundled to `dist/index.js` for distribution
- **D-03:** Uses `@actions/core`, `@actions/exec`, `@actions/io` from the Actions toolkit
- **D-04:** Version subdirectory name is always auto-derived from the git ref by sanitizing invalid filesystem characters (replacing `/`, `\`, `:`, etc. with hyphens)
- **D-05:** No explicit version name override input -- the name is deterministic from the ref
- **D-06:** Examples: `refs/tags/v2.1.0` -> `v2.1.0/`, `refs/heads/feature/auth` -> `feature-auth/`, `refs/pull/42/merge` -> `pr-42/`
- **D-07:** Concurrency is handled by GitHub's built-in concurrency groups, not by the action itself
- **D-08:** Documentation recommends users add `concurrency: { group: gh-pages-deploy, cancel-in-progress: false }` to their workflow
- **D-09:** Inject `<base href="/repo-name/version/">` into the `<head>` of all HTML files by default
- **D-10:** Provide a configuration option to enable full URL rewriting in HTML for sites with absolute paths
- **D-11:** Apply base path correction to all `.html` files, not just `index.html`

### Claude's Discretion
- Manifest JSON schema design (fields, format, extensibility)
- Build/bundle tooling choice (ncc, esbuild, or similar)
- Git operations implementation details (fetch, checkout, commit, push mechanics)
- Error messaging and logging approach
- Action input validation

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

**IMPORTANT NOTE on D-01:** The user locked `runs.using: node20` during context gathering. However, research reveals that Node 20 reached EOL in April 2026 and GitHub runners will default to Node 24 starting June 2026. The official TypeScript Action template has already migrated to `node24`. The planner should flag this for user confirmation -- switching to `node24` is strongly recommended but contradicts a locked decision. [VERIFIED: GitHub Changelog, official template]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPL-01 | Deploy build output into versioned subdirectory without disturbing existing versions | Additive-only push pattern (never force-push). Git worktree isolates gh-pages operations. Content Placer copies into version subdir. |
| DEPL-02 | Version subdirectory name derived from git ref | Ref Resolver sanitizes ref name per D-04/D-06 rules. Store both original ref and sanitized name in manifest. |
| DEPL-03 | Configurable glob/regex patterns to filter which refs trigger deployment | Action input for ref patterns. Ref Resolver checks current ref against patterns before proceeding. |
| DEPL-04 | Base path correction so sites work from subdirectory | `<base href>` injection (D-09) with fragment link fix. Full URL rewriting mode (D-10) as opt-in. |
| DEPL-05 | Concurrent deployments do not corrupt each other | GitHub concurrency groups (D-07/D-08). Fetch-retry loop as defense-in-depth. |
| MNFST-01 | JSON manifest at gh-pages root tracks all deployed versions | `versions.json` as single source of truth. Schema designed for extensibility (Phase 2 adds metadata fields). |
| MNFST-04 | Manifest updated atomically with deployment content | Single git commit contains both version directory changes and manifest update. |
| GHUB-01 | Packaged as GitHub Action (`uses: owner/action@v1`) | `action.yml` with `runs.using: node24` (or node20 per D-01), bundled `dist/index.js`. |
| GHUB-02 | Action accepts inputs: source directory, ref patterns, target branch | `action.yml` inputs with defaults. Version name auto-derived (D-04/D-05). |
| GHUB-03 | Works in standard GitHub Actions runner environment | Linux runner, git available, GITHUB_TOKEN for pushing. No external dependencies. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Primary language | Official GH Action template uses TS. Type safety critical for git operations. Note: TS 6.x was in project research but npm registry shows 5.9.3 as latest stable. [VERIFIED: npm registry] |
| @actions/core | 3.0.0 | Action inputs, outputs, logging | Official toolkit, no alternative. [VERIFIED: npm registry] |
| @actions/exec | 3.0.0 | Running git CLI commands | Official toolkit for process spawning with stdout/stderr capture. [VERIFIED: npm registry] |
| @actions/io | 3.0.2 | File system operations (cp, mv, mkdir) | Official toolkit, cross-platform. [VERIFIED: npm registry] |

### Bundling
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rollup | 4.60.1 | Bundle Action into single dist/index.js | Official GH Action template switched from ncc to Rollup. [VERIFIED: official template repo + npm registry] |
| @rollup/plugin-typescript | 12.3.0 | TypeScript compilation in Rollup | Required for TS source. [VERIFIED: npm registry] |
| @rollup/plugin-node-resolve | 16.0.3 | Resolve node_modules in bundle | Required to inline dependencies. [VERIFIED: npm registry] |
| @rollup/plugin-commonjs | 29.0.2 | Convert CJS to ESM for bundling | @actions/* packages are CJS, must convert. [VERIFIED: npm registry] |

### Testing
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 4.1.2 | Unit and integration tests | Modern, fast, TS-native. Project research chose Vitest over Jest. [VERIFIED: npm registry] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Rollup | @vercel/ncc | ncc was the previous standard but official template migrated to Rollup. ncc is simpler but less maintained. |
| Rollup | esbuild | Faster builds but more config needed for Node.js/Action bundling edge cases. |
| Vitest | Jest | Official template uses Jest. Either works; Vitest is better DX for new project. |
| TypeScript 5.9 | TypeScript 6.x | TS 6.x does not appear on npm registry as of research date. Project research referenced it but it may not exist yet. [VERIFIED: npm shows 5.9.3 as latest] |

**Installation:**
```bash
# Core dependencies
npm install @actions/core@3 @actions/exec@3 @actions/io@3

# Dev dependencies
npm install -D typescript@5.9 rollup@4 @rollup/plugin-typescript @rollup/plugin-node-resolve @rollup/plugin-commonjs vitest@4 @types/node@24
```

## Architecture Patterns

### Recommended Project Structure
```
gh-pages-multiplexer/
  action.yml                # Action metadata (inputs, outputs, runs.using: node24)
  rollup.config.ts          # Rollup bundler configuration
  tsconfig.json             # TypeScript configuration (ES2022, NodeNext)
  src/
    index.ts                # Entry point -- wires pipeline stages
    ref-resolver.ts         # Extract git metadata, sanitize ref name
    branch-manager.ts       # All git operations on gh-pages (worktree, commit, push)
    manifest-manager.ts     # Read/update/write versions.json
    content-placer.ts       # Copy build output, inject base href
    base-path.ts            # Base href injection + URL rewriting logic
    types.ts                # Shared TypeScript interfaces
  dist/
    index.js                # Rollup-compiled bundle (committed to repo)
  __tests__/
    ref-resolver.test.ts
    branch-manager.test.ts
    manifest-manager.test.ts
    content-placer.test.ts
    base-path.test.ts
```

### Pattern 1: Five-Stage Pipeline (always executes all stages)
**What:** Every deployment runs the same stages in the same order. Variability lives in the data (new version vs. re-deploy of existing version), never in whether a stage runs.
**When to use:** Every deployment invocation. // [LAW:dataflow-not-control-flow]
**Example:**
```typescript
// Source: project research ARCHITECTURE.md
export async function deploy(config: DeployConfig): Promise<DeployResult> {
  const context = await resolveRef(config);
  const workdir = await prepareBranch(config);
  const manifest = await updateManifest(workdir, context);
  await placeContent(workdir, config.sourceDir, context, config.basePath);
  await commitAndPush(workdir, context);
  return { version: context.versionSlot, url: computeUrl(config, context) };
}
```

### Pattern 2: Git Worktree for gh-pages Operations
**What:** Use `git worktree add` to mount the gh-pages branch in a temporary directory. Never switch the main checkout.
**When to use:** Every deployment -- the build output exists in the main checkout and must not be disturbed.
**Example:**
```typescript
// Source: peaceiris/actions-gh-pages pattern + project research
async function prepareBranch(config: DeployConfig): Promise<string> {
  const workdir = path.join(os.tmpdir(), 'gh-pages-work');
  await exec('git', ['fetch', 'origin', 'gh-pages', '--depth=1']);
  await exec('git', ['worktree', 'add', workdir, 'origin/gh-pages']);
  return workdir;
}
```

### Pattern 3: Atomic Manifest + Content Commit
**What:** Version directory changes and manifest update go into a single git commit. They cannot diverge.
**When to use:** Every deployment. // [LAW:one-source-of-truth]

### Pattern 4: Idempotent Deploys
**What:** Re-deploying the same version slot replaces its content and updates its manifest entry. The operation is identical whether the slot is new or existing -- only the data differs.
**When to use:** Always. // [LAW:dataflow-not-control-flow]

### Anti-Patterns to Avoid
- **Force-push to gh-pages:** Destroys all previous versions. Always use additive fast-forward push.
- **Checking out gh-pages in the same worktree:** Destroys build output. Use `git worktree add`.
- **Deriving version list from directory listing:** The manifest is truth, directories are derived. // [LAW:one-source-of-truth]
- **Conditional stage execution:** All stages run every time. Data decides behavior, not control flow. // [LAW:dataflow-not-control-flow]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process execution in Actions | Custom child_process wrappers | `@actions/exec` | Handles exit codes, stdout/stderr capture, logging integration |
| File copy operations | Custom recursive copy | `@actions/io.cp()` with `-r` | Cross-platform, handles permissions, follows symlinks correctly |
| Action input parsing | Manual `process.env.INPUT_*` | `@actions/core.getInput()` | Handles trimming, required validation, default values |
| Git operations | isomorphic-git or simple-git | `@actions/exec` + git CLI | Git is guaranteed on runners; CLI is transparent and debuggable |
| HTML parsing for base href | Full DOM parser (jsdom) | Regex-based injection into `<head>` | We insert one tag after `<head>` -- no need to parse a full DOM. Pattern: `/(<head[^>]*>)/i` replacement |

**Key insight:** The Actions toolkit exists precisely to solve the CI environment's peculiarities. Using it means inheriting GitHub's own testing and maintenance of these edge cases.

## Common Pitfalls

### Pitfall 1: Force-Push Destroys Previous Versions
**What goes wrong:** Copying patterns from single-deploy tools (peaceiris, JamesIves) that use force-push semantics.
**Why it happens:** Those tools assume replacement deployment. Our tool accumulates versions.
**How to avoid:** Always fetch existing gh-pages, add on top, normal push. Never `--force`.
**Warning signs:** Second deploy wipes first version's directory.

### Pitfall 2: Fragment/Hash Links Break with `<base href>`
**What goes wrong:** Pages with `<a href="#section">` links navigate away from the current page instead of scrolling to the section. The `<base href>` causes `#section` to resolve as `base-url/#section`, triggering a full navigation.
**Why it happens:** This is specified HTML behavior -- the base element changes the resolution of ALL relative URLs including fragment-only links. [VERIFIED: MDN Web Docs]
**How to avoid:** During `<base href>` injection, also rewrite fragment-only links in the same file. Transform `href="#foo"` to `href="current-filename.html#foo"` (or the page's own path). This makes them explicit same-page references unaffected by `<base>`.
**Warning signs:** Clicking a table-of-contents or section link on a deployed page navigates to the base URL instead of scrolling.

### Pitfall 3: Existing `<base href>` in Source HTML
**What goes wrong:** The source HTML already has a `<base href>` tag. The tool injects a second one. Per HTML spec, only the first `<base href>` is honored -- subsequent ones are ignored. If the existing tag comes first, the tool's injection has no effect. [VERIFIED: MDN Web Docs]
**Why it happens:** Some static site generators (particularly Angular apps) emit `<base href="/">`.
**How to avoid:** Before injecting, check if a `<base>` tag already exists. If it does, replace its `href` value rather than adding a new tag.
**Warning signs:** Deployed site's assets all 404 because the existing `<base href="/">` takes precedence.

### Pitfall 4: GitHub Pages Jekyll Processing
**What goes wrong:** GitHub runs Jekyll on gh-pages by default. Directories starting with `_` are ignored. Files may be transformed.
**Why it happens:** Jekyll is the default build pipeline for GitHub Pages.
**How to avoid:** Ensure `.nojekyll` file exists at gh-pages root on every deployment.
**Warning signs:** `_shared/` directory or `_assets/` directory contents are missing from the served site.

### Pitfall 5: CNAME File Deletion
**What goes wrong:** Custom domain configuration (CNAME file at gh-pages root) is accidentally deleted during deployment.
**Why it happens:** The deployment process modifies the gh-pages root -- careless file operations can delete existing root files.
**How to avoid:** The deployment is purely additive. Only write to: version subdirectory, `versions.json`, `index.html`, `.nojekyll`. Never delete root files.
**Warning signs:** Custom domain stops working after a deployment.

### Pitfall 6: GitHub Pages Path Varies by Repository Type
**What goes wrong:** Base path calculation assumes project-site format (`/repo-name/version/`) but the repo uses a custom domain (`/version/`) or is a user site (`/version/`).
**Why it happens:** Three URL patterns exist: user site (`username.github.io/`), project site (`username.github.io/repo-name/`), custom domain (`custom.com/`).
**How to avoid:** Detect context: check for CNAME file (custom domain), check if repo name matches `*.github.io` pattern (user site), otherwise assume project site. Allow explicit override via action input.
**Warning signs:** All asset paths have an extra or missing path segment.

### Pitfall 7: Non-Fast-Forward Push on Concurrent Deploy
**What goes wrong:** Two deployments fetch the same gh-pages HEAD. Both commit on top. Second push fails.
**Why it happens:** Even with concurrency groups, edge cases exist (different workflows, manual triggers).
**How to avoid:** Implement fetch-retry loop: if push fails with non-fast-forward, re-fetch gh-pages, replay changes on top, retry. 3 retries with backoff. This is defense-in-depth alongside concurrency groups (D-07/D-08).
**Warning signs:** Deployment fails with "non-fast-forward" error.

### Pitfall 8: Shallow Clone Loses Git Metadata
**What goes wrong:** `actions/checkout` defaults to `fetch-depth: 1`. The tool cannot extract commit history for the manifest.
**Why it happens:** Performance optimization in CI.
**How to avoid:** In Phase 1, the manifest only needs the triggering commit SHA and timestamp (not full history). Document that `fetch-depth: 0` is recommended for Phase 2's rich metadata. Detect shallow repo and warn.
**Warning signs:** Manifest has minimal metadata despite rich commit history in the repo.

## Code Examples

### action.yml Structure
```yaml
# Source: Official GitHub typescript-action template [VERIFIED]
name: 'gh-pages-multiplexer'
description: 'Deploy static sites to versioned subdirectories on gh-pages'
author: 'bmf'

inputs:
  source-dir:
    description: 'Directory containing build output to deploy'
    required: true
  target-branch:
    description: 'Branch to deploy to'
    required: false
    default: 'gh-pages'
  ref-patterns:
    description: 'Glob patterns for refs that trigger deployment (comma-separated)'
    required: false
    default: '*'
  base-path-mode:
    description: 'Base path correction mode: "base-tag" (default) or "rewrite"'
    required: false
    default: 'base-tag'
  token:
    description: 'GitHub token for pushing to the target branch'
    required: false
    default: ${{ github.token }}

outputs:
  version:
    description: 'The deployed version name (sanitized from ref)'
  url:
    description: 'The URL of the deployed version'

runs:
  using: 'node24'
  main: 'dist/index.js'
```

### Ref Sanitization
```typescript
// Source: Decision D-04, D-06
function sanitizeRef(ref: string): string {
  // refs/tags/v2.1.0 -> v2.1.0
  // refs/heads/feature/auth -> feature-auth
  // refs/pull/42/merge -> pr-42
  const stripped = ref
    .replace(/^refs\/tags\//, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/pull\/(\d+)\/merge$/, 'pr-$1');

  // Replace filesystem-unsafe characters with hyphens
  return stripped
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
```

### Base Href Injection with Fragment Fix
```typescript
// Source: MDN base element docs [VERIFIED] + Pitfall 2 mitigation
function injectBaseHref(html: string, basePath: string, filename: string): string {
  // If a <base> tag already exists, replace its href (Pitfall 3)
  const existingBase = /<base\s[^>]*href="[^"]*"[^>]*>/i;
  if (existingBase.test(html)) {
    return html.replace(existingBase, `<base href="${basePath}">`);
  }

  // Inject after <head>
  const injected = html.replace(
    /(<head[^>]*>)/i,
    `$1\n<base href="${basePath}">`
  );

  // Fix fragment-only links: href="#foo" -> href="filename#foo"
  // This prevents <base> from breaking in-page navigation
  return injected.replace(
    /href="#([^"]+)"/gi,
    `href="${filename}#$1"`
  );
}
```

### Manifest Schema (Phase 1 -- minimal, extensible)
```typescript
// Source: Claude's discretion area. Designed for Phase 2 extensibility.
interface ManifestEntry {
  version: string;        // sanitized directory name (e.g., "v2.1.0")
  ref: string;            // original git ref (e.g., "refs/tags/v2.1.0")
  sha: string;            // commit SHA at deploy time
  timestamp: string;      // ISO 8601 deploy timestamp
}

// versions.json top-level structure
interface Manifest {
  schema: 1;              // schema version for forward compatibility
  versions: ManifestEntry[];  // ordered by timestamp descending (newest first)
}
```

The `schema` field enables Phase 2 to add fields (authors, commit messages) without breaking Phase 1 consumers. New fields are additive -- old consumers ignore them.

### Git Worktree Setup
```typescript
// Source: peaceiris/actions-gh-pages pattern + git documentation [VERIFIED]
async function setupWorktree(): Promise<string> {
  const workdir = path.join(os.tmpdir(), `gh-pages-${Date.now()}`);

  // Configure git identity for the commit
  await exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

  // Fetch only the latest state of gh-pages
  const fetchResult = await exec('git', ['fetch', 'origin', 'gh-pages', '--depth=1'], { ignoreReturnCode: true });

  if (fetchResult !== 0) {
    // gh-pages branch does not exist yet -- create orphan
    await exec('git', ['worktree', 'add', '--detach', workdir]);
    await exec('git', ['-C', workdir, 'checkout', '--orphan', 'gh-pages']);
    await exec('git', ['-C', workdir, 'rm', '-rf', '.']);
  } else {
    await exec('git', ['worktree', 'add', workdir, 'origin/gh-pages']);
  }

  return workdir;
}
```

### Commit and Push with Retry
```typescript
// Source: Pitfall 7 mitigation + concurrency discussion
async function commitAndPush(workdir: string, context: DeploymentContext, maxRetries = 3): Promise<void> {
  await exec('git', ['-C', workdir, 'add', '-A']);
  await exec('git', ['-C', workdir, 'commit', '-m', `Deploy ${context.versionSlot}`]);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await exec('git', ['-C', workdir, 'push', 'origin', 'gh-pages'], { ignoreReturnCode: true });
    if (result === 0) return;

    if (attempt < maxRetries) {
      core.warning(`Push failed (attempt ${attempt}/${maxRetries}), fetching latest and retrying...`);
      await exec('git', ['-C', workdir, 'fetch', 'origin', 'gh-pages', '--depth=1']);
      await exec('git', ['-C', workdir, 'rebase', 'origin/gh-pages']);
    }
  }

  throw new Error('Failed to push to gh-pages after retries');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `runs.using: node20` | `runs.using: node24` | 2025-2026 | Official template migrated. Node 20 EOL April 2026. Runners default to node24 June 2026. [VERIFIED: GitHub Changelog] |
| `@vercel/ncc` for bundling | Rollup for bundling | 2025 | Official TypeScript Action template switched to Rollup. [VERIFIED: official template repo] |
| `type: "commonjs"` | `type: "module"` (ESM) | 2025 | Official template now uses ESM. [VERIFIED: official template package.json] |
| TypeScript target ES6 | TypeScript target ES2022 | 2024 | Official template uses ES2022 + NodeNext modules. [VERIFIED: official template tsconfig.json] |

**Deprecated/outdated:**
- `@vercel/ncc`: Still works but no longer the official recommendation. Rollup is the current template choice.
- `runs.using: node20`: Deprecated as of late 2025. Will stop working fall 2026.
- TypeScript 6.x: Referenced in project research but does not appear to exist on npm. Latest stable is 5.9.3. [VERIFIED: npm registry]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fragment link rewriting (`href="#foo"` -> `href="filename#foo"`) fully solves the base-href-breaks-anchors problem for all static site generators | Code Examples / Pitfall 2 | Some sites may use JavaScript-based navigation that reads href values at runtime; the rewrite could interfere. LOW risk -- most static sites use standard anchor links. |
| A2 | Regex-based HTML injection (`/<head[^>]*>/i`) is sufficient; a DOM parser is not needed | Don't Hand-Roll | HTML files with unusual head tag formatting (attributes, whitespace) might not match. LOW risk -- static site generator output is well-formed. |
| A3 | The official template's move to Rollup means ncc is no longer recommended | State of the Art | ncc still works fine; Rollup is just the new default in the template. Choosing either is valid. |
| A4 | `git rebase origin/gh-pages` in the retry loop is safe because each deployment adds to non-overlapping paths | Code Examples | Two deploys to the SAME version slot would conflict during rebase. Concurrency groups (D-07) prevent this in practice. |

## Open Questions (RESOLVED)

1. **Node 20 vs Node 24 (D-01 conflict)**
   - What we know: User locked D-01 as `runs.using: node20`. GitHub deprecated node20, official template uses node24, runners default to node24 June 2026.
   - RESOLVED: Use `node20` per D-01 locked decision. Add TODO comment in action.yml noting the deprecation timeline. Code has no node-version-specific dependencies; switching to `node24` is a one-line change when the user is ready. Research noted the conflict; planner honored the user's decision.

2. **Full URL rewriting scope (D-10)**
   - What we know: D-10 says "rewriting src, href, and similar attributes" for sites with absolute paths.
   - RESOLVED: Phase 1 URL rewriting mode rewrites `src` and `href` attributes in HTML only. These two attributes cover the vast majority of root-relative URL references in static site output. CSS `url()` rewriting is out of scope for Phase 1 -- can be added later if users request it.

3. **Ref pattern matching syntax (DEPL-03)**
   - What we know: Users need to filter which refs trigger deployment.
   - RESOLVED: Use glob patterns via `picomatch` library. Glob syntax is simpler than regex and matches the conventions users already know from GitHub Actions `on.push.tags` patterns and `.gitignore`. `picomatch` chosen over `minimatch` for smaller bundle size and better performance.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + action runtime | Yes | v24.13.0 | -- |
| npm | Package management | Yes | 11.6.2 | -- |
| git | All deployment operations | Yes | 2.52.0 | -- |

No missing dependencies. All required tools are available locally and are guaranteed on GitHub Actions runners.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (Wave 0 -- does not exist yet) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPL-01 | Deploying a version preserves existing version directories | unit | `npx vitest run __tests__/content-placer.test.ts -t "preserves existing"` | No -- Wave 0 |
| DEPL-02 | Version name derived from git ref via sanitization | unit | `npx vitest run __tests__/ref-resolver.test.ts -t "sanitize"` | No -- Wave 0 |
| DEPL-03 | Ref patterns filter which refs deploy | unit | `npx vitest run __tests__/ref-resolver.test.ts -t "pattern"` | No -- Wave 0 |
| DEPL-04 | Base href injected; fragment links preserved | unit | `npx vitest run __tests__/base-path.test.ts` | No -- Wave 0 |
| DEPL-05 | Push retry on non-fast-forward | unit | `npx vitest run __tests__/branch-manager.test.ts -t "retry"` | No -- Wave 0 |
| MNFST-01 | Manifest tracks all deployed versions | unit | `npx vitest run __tests__/manifest-manager.test.ts -t "tracks"` | No -- Wave 0 |
| MNFST-04 | Manifest updated in same commit as content | integration | `npx vitest run __tests__/deploy.test.ts -t "atomic"` | No -- Wave 0 |
| GHUB-01 | action.yml valid and dist/index.js exists | smoke | `node dist/index.js` (with mock env) | No -- Wave 0 |
| GHUB-02 | Action inputs parsed correctly | unit | `npx vitest run __tests__/inputs.test.ts` | No -- Wave 0 |
| GHUB-03 | Works with GITHUB_TOKEN auth | integration | Manual -- requires GitHub runner | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- test framework configuration
- [ ] `__tests__/ref-resolver.test.ts` -- covers DEPL-02, DEPL-03
- [ ] `__tests__/branch-manager.test.ts` -- covers DEPL-05
- [ ] `__tests__/manifest-manager.test.ts` -- covers MNFST-01, MNFST-04
- [ ] `__tests__/content-placer.test.ts` -- covers DEPL-01
- [ ] `__tests__/base-path.test.ts` -- covers DEPL-04
- [ ] `__tests__/inputs.test.ts` -- covers GHUB-02
- [ ] Framework install: `npm install -D vitest@4`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- uses GITHUB_TOKEN provided by runner |
| V3 Session Management | No | N/A -- stateless CI operation |
| V4 Access Control | Yes (minimal) | GITHUB_TOKEN scoped to repo. Push permission required for target branch. |
| V5 Input Validation | Yes | Validate all action inputs. Sanitize ref names for filesystem safety. Validate HTML before injection. |
| V6 Cryptography | No | N/A -- no secrets beyond GITHUB_TOKEN |

### Known Threat Patterns for GitHub Actions

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Ref name injection (malicious branch name -> filesystem traversal) | Tampering | Sanitize ref name: strip `..`, `/`, null bytes. Validate result is a single path segment. |
| HTML injection via build output | Tampering | Content is user-controlled by design (it is their site). No additional sanitization needed -- we copy, not interpret. |
| GITHUB_TOKEN scope escalation | Elevation | Use default token (contents: write). Never request broader permissions. |
| Workflow injection via PR | Tampering | Action runs in the context of the triggering workflow. PR preview deployments should use `pull_request` event (read-only token by default). |

## Sources

### Primary (HIGH confidence)
- [GitHub Actions Metadata Syntax](https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions) -- action.yml format, `runs.using` options
- [GitHub TypeScript Action Template](https://github.com/actions/typescript-action) -- current template (node24, Rollup, ESM)
- [MDN: HTML base element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/base) -- base href behavior, multiple tags, fragment links
- [GitHub Changelog: Node 20 deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) -- deprecation timeline
- npm registry (verified 2026-04-05) -- all package versions
- [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) -- git operations patterns
- Project research files (`.planning/research/*.md`) -- architecture, stack, pitfalls

### Secondary (MEDIUM confidence)
- [Git worktree for gh-pages deployment](https://gist.github.com/ErickPetru/b1b3138ab0fc6c82cd19ea3a1a944ba6) -- worktree deployment pattern
- [Understanding base tag and anchor conflicts](https://paulserban.eu/blog/post/understanding-the-html-base-tag-and-resolving-conflicts-with-anchor-links/) -- base href fragment link problem
- [GitHub Pages base path handling](https://devactivity.com/posts/apps-tools/mastering-github-pages-configure-base-paths-for-seamless-project-deployments/) -- base href approach for project sites

### Tertiary (LOW confidence)
- None -- all findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via npm registry, template patterns verified against official GitHub repo
- Architecture: HIGH -- pipeline pattern proven by mike and peaceiris, data contracts well-defined in project research
- Pitfalls: HIGH -- base href fragment issue verified against MDN spec, all other pitfalls from project research (sourced from real-world issues)
- Base path correction: MEDIUM -- fragment link rewriting approach is sound in principle but untested against every SSG output format

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (30 days -- stable domain, main risk is node24 timeline acceleration)
