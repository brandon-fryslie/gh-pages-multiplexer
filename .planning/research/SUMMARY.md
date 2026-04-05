# Project Research Summary

**Project:** gh-pages-multiplexer
**Domain:** Versioned GitHub Pages deployment tooling
**Researched:** 2026-04-05
**Confidence:** HIGH

## Executive Summary

gh-pages-multiplexer is a GitHub Action that deploys multiple versions of a static site to subdirectories on a single gh-pages branch. The established pattern for this (proven by mike, gh-pages-multi, and pr-preview-action) is: orphan branch, subdirectory-per-version, JSON manifest at root, additive commits only. The stack is TypeScript on Node 20, using the official GitHub Actions toolkit (`@actions/core`, `@actions/exec`) to call the git CLI directly. The project differentiates from existing tools by being content-agnostic (works with any static site, not just MkDocs) and by providing a rich index page with git metadata plus an injected cross-version navigation widget.

The recommended approach is a five-component pipeline: Ref Resolver, Branch Manager, Manifest Manager, Content Placer, and Index Generator. The manifest (`versions.json`) is the single source of truth -- the index page and nav widget are both derived from it. The nav widget is a separate runtime artifact using Shadow DOM for style isolation, loaded via an injected script tag pointing to a shared asset on gh-pages. Every pipeline step always executes; variability lives in the data (new version vs. updated version), not in control flow.

The critical risks are: (1) force-push destroying previously deployed versions -- the tool must use additive-only push semantics from day one, (2) concurrent deployments causing non-fast-forward rejections -- mitigated by GitHub Actions concurrency groups plus a fetch-retry loop, and (3) relative path breakage when sites are served from versioned subdirectories -- solved by injecting `<base href>` tags during deployment. Secondary risks include gh-pages branch bloat over time (mitigated by shallow clones and eventual version pruning) and the nav widget conflicting with arbitrary host page styles (mitigated by Shadow DOM isolation).

## Key Findings

### Recommended Stack

TypeScript on Node 20, bundled with `@vercel/ncc` into a single `dist/index.js`. Git operations use `@actions/exec` calling the git CLI directly -- no wrapper libraries. The index page uses template literals (no template engine for a single file). The nav widget is vanilla JavaScript with Shadow DOM. Testing with Vitest. See [STACK.md](STACK.md) for full rationale and version numbers.

**Core technologies:**
- **TypeScript 6.x**: Primary language -- type safety matters for git operations where wrong strings silently corrupt branches
- **@actions/core + @actions/exec**: Official GitHub Actions toolkit -- no alternative exists, provides input/output/logging and process spawning
- **@vercel/ncc**: Bundles Action into single file -- industry standard for GitHub Actions, used by the official TypeScript Action template
- **Vanilla JS + Shadow DOM**: Nav widget -- must inject into arbitrary pages without conflicts, zero dependencies
- **JSON manifest**: Browser-consumable structured data -- no parser library needed unlike YAML

### Expected Features

See [FEATURES.md](FEATURES.md) for full landscape analysis.

**Must have (table stakes):**
- Versioned subdirectory deployment -- the entire point of the tool
- Manifest generation -- single source of truth for all version-aware features
- Preserve existing versions on deploy -- the fundamental contract
- Configurable version naming -- necessary for real workflows
- Root index page -- users need a landing page listing versions
- Default version redirect -- root URL must go somewhere useful
- Version cleanup/deletion -- without this, gh-pages grows unbounded

**Should have (differentiators):**
- Rich index page with timeline, git metadata, commit history -- genuinely novel for GitHub Pages
- Injected cross-version navigation widget -- content-agnostic version switcher is rare
- Same-page cross-version navigation -- navigate to same path in different version
- Git metadata extraction at deploy time -- automatic DX improvement over manual metadata
- Outdated version banner -- warn users viewing old versions
- PR comment with preview link -- expected from Vercel/Netlify, low complexity

**Defer (v2+):**
- Retention policy / auto-cleanup -- users can delete manually for now
- Version sorting options -- manifest has timestamps, sort client-side
- Version aliasing -- useful but not blocking adoption

### Architecture Approach

The system is a five-stage pipeline where each stage always executes. The gh-pages branch is managed via `git worktree` (never switching the main checkout). The manifest is the keystone: written by the Action during deployment, read by the nav widget at browse-time, consumed by the index generator at deploy-time. The Action and widget are separate artifacts that share only the manifest schema. See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries, data contracts, and data flow.

**Major components:**
1. **Ref Resolver** -- extracts git metadata (SHA, authors, messages, timestamps) into a DeploymentContext
2. **Branch Manager** -- all git operations on gh-pages: fetch, worktree, commit, push
3. **Manifest Manager** -- reads/updates/writes `versions.json`, the single source of truth
4. **Content Placer** -- copies build output into versioned subdirectory, injects nav widget script tag
5. **Index Generator** -- generates static `index.html` from manifest data

**Key patterns:**
- Orphan branch with `git worktree` (never disturb main checkout)
- Manifest as single source of truth (index and widget are derived)
- Script tag injection, not inline code (one widget codebase serves all versions)
- Idempotent deploys (redeploying a version replaces its content and manifest entry)

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 12 pitfalls with detection strategies.

1. **Force-push destroys previous versions** -- never force-push to gh-pages; always fetch, add, commit, push (additive only)
2. **Concurrent deployments cause non-fast-forward rejection** -- use GitHub Actions concurrency groups with `cancel-in-progress: false` plus a fetch-retry loop (3-5 retries)
3. **Relative paths break in versioned subdirectories** -- inject `<base href>` into each HTML file's `<head>` during deployment
4. **gh-pages branch bloat over time** -- use `--depth=1` for all fetches; provide version pruning command later
5. **GitHub Pages Jekyll processing mangles files** -- always include `.nojekyll` at gh-pages root
6. **GitHub Pages path varies by repo type** -- detect user-site vs. project-site vs. custom-domain and calculate base path accordingly

## Implications for Roadmap

### Phase 1: Core Deployment Pipeline

**Rationale:** Everything depends on reliable git operations and the manifest contract. Nothing else matters if deployment is broken.
**Delivers:** Working GitHub Action that deploys a build directory into a versioned subdirectory on gh-pages, with manifest tracking.
**Addresses:** Versioned subdirectory deployment, manifest generation, preserve existing versions, configurable version naming, GitHub Action integration.
**Avoids:** Force-push destruction (P1), concurrent deploy conflicts (P2), Jekyll interference (P10), CNAME deletion (P11), version name sanitization (P9).
**Components:** Branch Manager, Manifest Manager, Ref Resolver (basic), Content Placer (without widget injection).
**Key decisions:** Base path detection for user-site/project-site/custom-domain (P8) must be solved here since it affects all path generation.

### Phase 2: Index Page and Version Management

**Rationale:** Once deployment works, users need to discover and manage versions. The index page and cleanup command are the first user-facing features beyond "deploy."
**Delivers:** Auto-generated root index page with version listing, default version redirect, version deletion command.
**Addresses:** Root index page, default version redirect, version cleanup/deletion.
**Avoids:** Manifest inconsistency (P5) -- deletion must atomically update manifest and remove directory.
**Components:** Index Generator (basic), Manifest Manager extensions (delete, set-default).

### Phase 3: Rich Index and Git Metadata

**Rationale:** This is the project's primary differentiator. The rich index with timeline, commit history, and author information is what sets this tool apart from alternatives. Requires the manifest contract to be stable (Phase 1-2).
**Delivers:** Rich index page with timeline view, commit metadata, diff stats. Enhanced metadata extraction from git history.
**Addresses:** Rich index page with timeline/metadata, git metadata extraction.
**Avoids:** Shallow clone metadata loss (P6) -- detect shallow repos, warn clearly, degrade gracefully.
**Components:** Ref Resolver (full metadata extraction), Index Generator (rich rendering).

### Phase 4: Navigation Widget

**Rationale:** The widget is the second major differentiator but is architecturally independent -- it only needs the manifest contract (stable since Phase 1). Building it after the index ensures the manifest schema is battle-tested.
**Delivers:** Floating version switcher injected into deployed pages, with same-page navigation and outdated version banner.
**Addresses:** Injected navigation widget, same-page cross-version navigation, outdated version banner.
**Avoids:** Widget style/script conflicts (P7) -- Shadow DOM isolation is mandatory. Widget manifest fetch path (P12) -- use absolute paths from site root.
**Components:** Nav Widget (standalone JS artifact), Content Placer (script tag injection).

### Phase 5: Polish and Ecosystem

**Rationale:** PR comments, aliasing, and retention policies are quality-of-life features that round out the tool but are not blocking adoption.
**Delivers:** PR preview comments, version aliasing (`latest` -> `v2.0`), retention policies (keep last N versions).
**Addresses:** PR comment with preview link, version aliasing, retention policy.
**Components:** GitHub API integration, Manifest Manager extensions.

### Phase Ordering Rationale

- Phases follow the dependency chain: git operations -> manifest -> index -> widget -> ecosystem features
- The manifest contract stabilizes in Phase 1 and is consumed by everything after
- The two differentiators (rich index and nav widget) are in separate phases because they are independent and each is substantial
- Core deployment pitfalls (P1-P3, P8-P11) are all addressed in Phase 1 because they affect the foundational invariant
- Widget pitfalls (P7, P12) are isolated to Phase 4 where they belong

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** `<base href>` injection edge cases -- pages that already set `<base href>` will conflict; need to research how common this is and what the fallback should be
- **Phase 4:** Shadow DOM widget injection patterns -- need to verify behavior with CSP policies, research how analytics widgets (Intercom, etc.) handle similar injection

Phases with standard patterns (skip research-phase):
- **Phase 2:** Index generation and version management are straightforward CRUD operations on the manifest
- **Phase 3:** Git metadata extraction is well-documented (`git log` formatting options); index rendering is template-based HTML generation
- **Phase 5:** GitHub API calls for PR comments are well-documented; aliasing via symlinks/redirects is proven by mike

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry; patterns match official GitHub Action templates and top community actions |
| Features | HIGH | Feature landscape mapped against 6+ existing tools (mike, gh-pages-multi, pr-preview-action, Read the Docs, Docusaurus, peaceiris/actions-gh-pages) |
| Architecture | HIGH | Pipeline pattern is proven by mike and peaceiris; data contracts are well-defined with TypeScript interfaces |
| Pitfalls | HIGH | Pitfalls sourced from real-world issues (Mozilla VPN 1.5GB repo, GitHub community discussions) and official documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **`<base href>` conflicts:** What percentage of static sites already set `<base href>`? What happens when two base tags exist? Needs testing during Phase 1 implementation.
- **Node 20 to Node 24 migration:** Node 20 deprecation is June 2026. The action should ship on node20 now but Phase 5 should include the migration. Low risk since code has no Node-version-specific dependencies.
- **`@github/local-action` maturity:** Recommended for local testing but relatively new tool. Verify during Phase 1 setup; fall back to manual workflow testing if it is insufficient.
- **gh-pages branch size limits in practice:** GitHub's 1GB soft / 5GB hard limits are documented but the practical threshold where clone performance degrades for GitHub Actions runners specifically is unknown. Monitor during real-world usage.

## Sources

### Primary (HIGH confidence)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit) -- official SDK, verified versions
- [GitHub TypeScript Action Template](https://github.com/actions/typescript-action) -- official starter template
- [mike (jimporter/mike)](https://github.com/jimporter/mike) -- primary reference for versioned gh-pages architecture
- [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) -- reference for gh-pages git operations
- [GitHub Docs: Concurrency control](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) -- concurrency groups
- [GitHub community: gh-pages branch bloat](https://github.com/mozilla-mobile/mozilla-vpn-client/issues/2479) -- real-world bloat data

### Secondary (MEDIUM confidence)
- [gh-pages-multi](https://github.com/koumoul-dev/gh-pages-multi) -- lightweight reference implementation, limited docs
- [rossjrw/pr-preview-action](https://github.com/rossjrw/pr-preview-action) -- PR preview deployment patterns
- [Material for MkDocs versioning](https://squidfunk.github.io/mkdocs-material/setup/setting-up-versioning/) -- version switcher UX patterns
- [Docusaurus versioning](https://docusaurus.io/docs/versioning) -- version dropdown, banners, aliases
- [GitHub Pages base path handling](https://devactivity.com/posts/apps-tools/mastering-github-pages-configure-base-paths-for-seamless-project-deployments/) -- base href approach

---
*Research completed: 2026-04-05*
*Ready for roadmap: yes*
