# Feature Landscape

**Domain:** Versioned GitHub Pages deployment tooling
**Researched:** 2026-04-05

## Table Stakes

Features users expect from any versioned deployment tool. Missing any of these and users will look elsewhere or build their own.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Versioned subdirectory deployment** | The entire point of the tool. Each version lands in its own path (e.g., `/v1.0.0/`, `/feature-branch/`). Mike, gh-pages-multi, pr-preview-action all do this. | Low | Core primitive everything else builds on |
| **Root index page** | Users need a landing page that lists available versions. gh-pages-multi generates a basic one; mike redirects root to default version. A bare directory listing is unacceptable. | Med | Must be auto-generated, not manually maintained |
| **Version cleanup/deletion** | Ability to remove old versions. Mike has `mike delete`. Without this, the gh-pages branch grows unbounded. | Low | CLI command and/or Action input |
| **Default version redirect** | Root URL redirects to "latest" or a designated default. Mike has `set-default`. Read the Docs uses `stable`. Users expect `/` to go somewhere useful. | Low | Simple redirect or alias mechanism |
| **Manifest/version list** | Machine-readable record of what versions exist. Docusaurus uses `versions.json`. Mike stores metadata in its branch. The widget and index page both need this. | Low | JSON file on gh-pages branch. Single source of truth for all version-aware features. |
| **GitHub Action integration** | Must be consumable as a step in existing workflows. Every comparable tool (peaceiris/actions-gh-pages, rossjrw/pr-preview-action, mike via CI) works this way. | Med | `uses: owner/action@v1` with sensible inputs |
| **Preserve existing versions on deploy** | New deployments must not clobber previous versions. This is the fundamental contract. pr-preview-action explicitly warns users to configure their main deploy to avoid deleting preview directories. | Low | Deploy to subdirectory, leave others untouched |
| **Configurable version naming** | Users need control over what the subdirectory is called: tag name, branch name, PR number, custom string. | Low | Input parameter, with sensible defaults (git ref name) |

## Differentiators

Features that set this project apart. Not expected from a bare-bones tool, but valued when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Rich index page with timeline/metadata** | Most tools generate a plain list (gh-pages-multi) or redirect to default (mike). A timeline view with commit history, authors, timestamps, and diff stats is genuinely novel for GitHub Pages. | High | This is the project's primary differentiator per PROJECT.md |
| **Injected cross-version navigation widget** | Floating version switcher injected into every deployed page. Read the Docs has their flyout menu; Material for MkDocs has a dropdown. But those are tied to specific doc frameworks. A content-agnostic widget that works with ANY static site is rare. | High | Must load manifest dynamically, be non-intrusive, work with arbitrary HTML |
| **Same-page cross-version navigation** | When switching versions, navigate to the same page path in the new version (not the root). PyData Sphinx Theme and Material for MkDocs do this. Requires checking if the path exists in the target version. | Med | Widget checks target URL existence, falls back to version root |
| **Git metadata extraction at deploy time** | Automatically capture commit history, authors, timestamps, and diff stats. Most tools require users to supply this metadata. Extracting it from git automatically is a meaningful DX improvement. | Med | Runs git commands during the Action step |
| **Version aliasing** | Point `latest` or `stable` at a specific version without duplicating files. Mike supports this via symlinks/redirects. Useful for "always point to newest release" semantics. | Med | Symlink or redirect file pointing alias to version directory |
| **Outdated version banner/warning** | When viewing an old version, show a banner saying "You're viewing v1.0 -- latest is v2.0". Read the Docs does this. Docusaurus has `unmaintained`/`unreleased` banners. Could be part of the injected widget. | Med | Injected along with the nav widget; reads manifest to determine staleness |
| **PR comment with preview link** | After deploying a PR preview, post a sticky comment on the PR with the URL. rossjrw/pr-preview-action does this with QR codes. Vercel/Netlify do it automatically. | Low | GitHub API call from the Action |
| **Version sorting options** | Sort versions by semver, date, or alphabetically. Read the Docs offers SemVer, CalVer, and alphabetical sorting. | Low | Manifest already has timestamps; sorting is a UI concern on the index page |
| **Retention policy / auto-cleanup** | Automatically delete versions older than N days, or keep only the latest N versions. No comparable GitHub Pages tool does this today. | Med | Configurable Action input; runs cleanup before/after deploy |

## Anti-Features

Features to explicitly NOT build. These either add complexity without value, violate the project's constraints, or are traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **iframe-based version embedding** | Already ruled out in PROJECT.md. Iframes break with CSP headers, relative paths, JavaScript-heavy pages, and responsive layouts. | Injected nav widget that modifies the page directly |
| **Preview thumbnails/screenshots** | High complexity (needs headless browser), large storage, slow deploys, low value. No comparable tool does this. | Rich text metadata (commit messages, authors, timestamps) provides enough context |
| **Custom themes/branding for index** | Premature customization. Every theme knob is maintenance burden. Ship one good default. | Sensible, modern default design. Maybe a CSS override hook later if demanded. |
| **Automatic changelog generation** | Parsing conventional commits, linking to issues, generating prose -- this is a solved problem with dedicated tools (semantic-release, release-please). Duplicating it adds complexity for marginal value. | Show raw git commit messages. Users who want rich changelogs already generate them. |
| **Build step integration** | The tool should not run builds. It should receive already-built output and deploy it. Coupling to build systems (webpack, vite, mkdocs) creates fragility and scope creep. | Accept a directory path as input. "Here are my built files, deploy them." |
| **Authentication/access control** | GitHub Pages is public (unless enterprise). Adding auth is a different product entirely. | Out of scope. Users who need private previews should use Netlify/Vercel. |
| **Multi-repo aggregation** | Combining docs from multiple repos into one site is a documentation platform feature (Read the Docs, Backstage), not a deployment tool feature. | Single repo, single gh-pages branch. |
| **Framework-specific integrations** | Building plugins for MkDocs, Docusaurus, Sphinx, etc. creates N integration surfaces to maintain. | Content-agnostic: works with any static output directory. The widget injects into raw HTML. |

## Feature Dependencies

```
Manifest ─────────────────────┬──────────────────────┐
  │                           │                      │
  v                           v                      v
Root Index Page          Nav Widget           Version Aliases
  │                      │       │                   │
  v                      v       v                   v
Timeline/Metadata    Same-Page   Outdated         Default Version
 (git extraction)    Navigation  Banner            Redirect
```

Key dependency chain:
- **Manifest** is the foundation. Everything version-aware reads from it.
- **Root index page** and **nav widget** both consume the manifest but are independent of each other.
- **Git metadata extraction** feeds into the manifest (enriching it with commit data) and the index page (displaying it).
- **Same-page navigation** and **outdated banner** are enhancements to the nav widget.
- **Version aliases** and **default redirect** interact (the default is often an alias like `latest`).
- **Retention/cleanup** operates on the manifest + filesystem independently.

## MVP Recommendation

Prioritize (Phase 1):
1. **Versioned subdirectory deployment** -- the core primitive
2. **Manifest generation** -- single source of truth, everything depends on it
3. **Preserve existing versions** -- the fundamental contract
4. **Configurable version naming** -- necessary for any real workflow
5. **GitHub Action integration** -- the primary consumption model

Prioritize (Phase 2):
6. **Root index page** with basic version listing
7. **Default version redirect**
8. **Version cleanup/deletion**
9. **CLI fallback** for use within existing workflows

Prioritize (Phase 3):
10. **Rich index page** with timeline, metadata, git history
11. **Git metadata extraction** to power the rich index
12. **Injected navigation widget**

Prioritize (Phase 4):
13. **Same-page cross-version navigation** in the widget
14. **Outdated version banner**
15. **Version aliasing**
16. **PR comment with preview link**

Defer:
- **Retention policy**: Nice to have but not blocking adoption. Users can run `delete` manually.
- **Version sorting options**: Manifest has timestamps; can sort client-side later.

**Rationale**: The deployment machinery must work before any UI features matter. The manifest is the keystone -- get it right early because the index and widget both depend on it. The rich index and widget are the differentiators but they're useless without reliable deployment underneath.

## Sources

- [mike (MkDocs versioning)](https://github.com/jimporter/mike) -- CLI for multi-version MkDocs on gh-pages
- [Material for MkDocs versioning setup](https://squidfunk.github.io/mkdocs-material/setup/setting-up-versioning/) -- version switcher UX patterns
- [Docusaurus versioning](https://docusaurus.io/docs/versioning) -- version dropdown, banners, aliases
- [gh-pages-multi](https://github.com/koumoul-dev/gh-pages-multi) -- basic subdirectory deployment with index
- [rossjrw/pr-preview-action](https://github.com/rossjrw/pr-preview-action) -- PR preview deploys to GitHub Pages
- [Read the Docs flyout menu](https://docs.readthedocs.com/platform/latest/flyout-menu.html) -- version switcher UX, outdated warnings
- [PyData Sphinx Theme version dropdown](https://pydata-sphinx-theme.readthedocs.io/en/stable/user_guide/version-dropdown.html) -- same-page navigation pattern
- [Netlify Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/) -- PR-based preview deployments
- [Vercel Preview Deployments](https://vercel.com/docs/deployments/environments) -- collaboration features, URL structure
- [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) -- popular GitHub Pages deploy action
