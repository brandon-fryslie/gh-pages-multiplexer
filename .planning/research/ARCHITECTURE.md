# Architecture Patterns

**Domain:** GitHub Pages versioned deployment tooling
**Researched:** 2026-04-05

## Prior Art Summary

Three deployment models exist in this space:

1. **mike (mkdocs)** -- Branch-based, subdirectory-per-version, `versions.json` manifest at root, version selector injected via build plugin. The closest analog to what we are building, but tightly coupled to MkDocs. **Confidence: HIGH** (reviewed source repo and docs).

2. **peaceiris/actions-gh-pages** -- Branch-based, pushes a build directory to gh-pages with force-commit. No versioning concept; each deploy replaces everything. Useful reference for the git operations layer only. **Confidence: HIGH**.

3. **actions/deploy-pages (official)** -- Artifact-based (upload tarball, deploy via API). Does NOT use the gh-pages branch at all. Irrelevant to our architecture except as a "what not to do" reference. **Confidence: HIGH**.

4. **gh-pages-multi** -- Branch-based, subdirectory-per-version, auto-generated index.html listing versions. Lightweight Node.js tool. Closest in spirit but minimal features (no manifest metadata, no nav widget). **Confidence: MEDIUM** (limited docs).

## Recommended Architecture

The system has five clearly bounded components that form a pipeline. Each component has a single responsibility and communicates through well-defined data contracts.

```
                    INPUT
                      |
                      v
            +-------------------+
            |  Ref Resolver     |  git metadata -> DeploymentContext
            +-------------------+
                      |
                      v
            +-------------------+
            |  Branch Manager   |  gh-pages branch checkout/merge
            +-------------------+
                      |
                      v
            +-------------------+
            |  Manifest Manager |  reads/updates versions.json
            +-------------------+
                      |
                      v
            +-------------------+
            |  Content Placer   |  copies build output + injects nav widget
            +-------------------+
                      |
                      v
            +-------------------+
            |  Index Generator  |  rebuilds root index.html from manifest
            +-------------------+
                      |
                      v
            +-------------------+
            |  Branch Manager   |  commit + push
            +-------------------+
                      |
                      v
                   OUTPUT
```

### Component Boundaries

| Component | Responsibility | Input | Output | Communicates With |
|-----------|---------------|-------|--------|-------------------|
| **Ref Resolver** | Extract git metadata (tag/branch name, commit SHA, authors, commit messages, timestamps) from the current repo state | Git repo + config (ref patterns) | `DeploymentContext` data object | Branch Manager (passes context forward) |
| **Branch Manager** | All git operations on gh-pages: fetch, checkout, commit, push. Owns the working tree for the deployment branch. | `DeploymentContext` + remote URL | Writable working directory on gh-pages branch | Manifest Manager, Content Placer, Index Generator (provides working dir) |
| **Manifest Manager** | Read, update, and write `versions.json`. Single source of truth for what versions exist. | Working directory + `DeploymentContext` | Updated `versions.json` on disk + parsed `Manifest` object in memory | Index Generator (manifest data), Content Placer (version slot name) |
| **Content Placer** | Copy build artifacts into versioned subdirectory. Inject nav widget script tag into HTML files. | Build directory path + version slot name + working directory | Versioned subdirectory populated on gh-pages working tree | None (leaf operation) |
| **Index Generator** | Generate root `index.html` from manifest data. Produces a self-contained static page with timeline, metadata, and links. | `Manifest` object | `index.html` written to working directory root | None (leaf operation) |

### The Nav Widget (separate artifact, not a pipeline component)

The nav widget is a standalone JavaScript file + CSS that gets:
1. **Built once** as a static asset (bundled JS + CSS)
2. **Placed** at a known path on gh-pages (e.g., `/_shared/nav-widget.js`)
3. **Injected** into each version's HTML files by Content Placer (a `<script>` tag pointing to the shared asset)
4. **Loaded at runtime** by the browser, where it fetches `versions.json` and renders a floating version switcher

This is NOT a build-time component. It is a runtime component that reads the manifest. Content Placer injects the reference; the widget itself is self-contained.

## Data Contracts

### DeploymentContext

```typescript
interface DeploymentContext {
  // What version slot to deploy into
  versionSlot: string;           // e.g., "v1.2.0" or "deploy_feature-x"

  // Git metadata captured at deploy time
  commitSha: string;
  commitTimestamp: string;        // ISO 8601
  authors: string[];              // from git log
  commitMessages: string[];       // commits since last deploy of this slot
  refName: string;                // original branch/tag name
  refType: "branch" | "tag";
}
```

### Manifest (versions.json)

```typescript
interface ManifestEntry {
  version: string;               // matches subdirectory name
  refName: string;               // original git ref
  refType: "branch" | "tag";
  commitSha: string;
  timestamp: string;             // ISO 8601 of deploy time
  authors: string[];
  commitMessages: string[];
  deployedAt: string;            // ISO 8601 of when deploy ran
}

// versions.json is an array: ManifestEntry[]
// Ordered by deployedAt descending (newest first).
```

This mirrors mike's `versions.json` pattern but with richer metadata. mike stores `{version, title, aliases}`. We store deploy-time git context because the index page needs it.

### Nav Widget Runtime Contract

The nav widget, once loaded in the browser:
1. Resolves its own URL to determine the base path of the gh-pages site
2. Fetches `<base>/versions.json`
3. Renders a floating UI with version list and link to index
4. Highlights the current version based on the URL path

No build-time coupling. Pure runtime dependency on the manifest file.

## Patterns to Follow

### Pattern 1: Orphan Branch with Sparse Checkout

**What:** The gh-pages branch is an orphan branch (no shared history with main). Branch Manager checks it out into a temporary working directory, makes changes, commits, pushes.

**When:** Every deployment.

**Why:** This is the universal pattern used by mike, peaceiris/actions-gh-pages, and gh-pages-multi. The orphan branch keeps deployment artifacts completely separate from source history. Sparse/shallow fetch keeps operations fast.

```bash
# First-time initialization
git checkout --orphan gh-pages
git rm -rf .
git commit --allow-empty -m "Initialize gh-pages"
git push origin gh-pages

# Subsequent deploys (in CI)
git fetch origin gh-pages --depth=1
git worktree add /tmp/gh-pages-work origin/gh-pages
# ... make changes in /tmp/gh-pages-work ...
cd /tmp/gh-pages-work
git add -A
git commit -m "Deploy version X"
git push origin gh-pages
```

**Key detail:** Use `git worktree` (not `git checkout`) to avoid disturbing the main branch checkout. This is critical in CI where the main branch is checked out for the build step.

### Pattern 2: Manifest as Single Source of Truth

**What:** `versions.json` at the root of gh-pages is the canonical record of all deployed versions. The index page is derived from it. The nav widget reads it at runtime. No other source of version truth exists.

**When:** Always. // [LAW:one-source-of-truth] manifest is the single authority on deployed versions

**Why:** mike uses this exact pattern (`versions.json`). It works because:
- Index can be regenerated from manifest alone (manifest is authoritative, index is derived)
- Nav widget loads manifest dynamically (no build-time coupling to version list)
- Adding/removing versions is an atomic manifest update + directory operation

### Pattern 3: Script Tag Injection (not inline code)

**What:** Content Placer injects a `<script src="/_shared/nav-widget.js"></script>` tag into HTML files, NOT inline JavaScript. The widget JS file lives at a shared location on gh-pages.

**When:** During content placement for each version.

**Why:**
- Single widget codebase serves all versions // [LAW:one-source-of-truth] widget code lives in one place
- Widget updates apply to all versions without redeploying them
- Avoids bloating each HTML file with duplicated JS
- Browser caches the shared script across version navigation

### Pattern 4: Idempotent Deploys

**What:** Deploying the same version slot twice replaces the previous content for that slot. The manifest entry is updated; the subdirectory is wiped and repopulated.

**When:** Every deploy to an existing version slot.

**Why:** mike does this ("previous docs for that version are erased and overwritten"). It is the correct behavior because:
- A branch may be deployed multiple times as it evolves
- No stale artifacts from previous deploys leak through
- Manifest stays consistent (one entry per version slot)

## Anti-Patterns to Avoid

### Anti-Pattern 1: Checking Out gh-pages in the Same Worktree

**What:** Switching the current checkout from main to gh-pages to make changes, then switching back.

**Why bad:** Destroys the build output that was just produced. Confuses CI state. Race conditions if anything reads the working tree during the switch.

**Instead:** Use `git worktree add` to mount gh-pages in a separate directory.

### Anti-Pattern 2: Inline Widget Code in Each HTML File

**What:** Embedding the full nav widget JavaScript directly into every HTML file during injection.

**Why bad:** Updating the widget requires redeploying every version. Duplicated code across thousands of HTML files. Impossible to fix bugs in old versions' widgets.

**Instead:** Inject a script tag referencing a shared asset. // [LAW:one-source-of-truth] widget code exists once

### Anti-Pattern 3: Deriving Version List from Directory Listing

**What:** Scanning the gh-pages branch for subdirectories to determine what versions exist.

**Why bad:** Directories might contain non-version content (_shared, assets, etc.). No metadata available. Ordering is ambiguous. Deletion requires both directory removal and... what? // [LAW:one-source-of-truth] manifest is truth, directories are derived

**Instead:** Manifest is authoritative. Directories exist because the manifest says they should.

### Anti-Pattern 4: Building the Index at Widget Load Time

**What:** Having the nav widget or client-side JS build the full index page dynamically from versions.json.

**Why bad:** No content for search engines or non-JS browsers. Slower initial load. The index is a known, derivable artifact -- generate it at deploy time as static HTML.

**Instead:** Generate static index.html from manifest during the deploy pipeline. The nav widget is a small overlay, not the index.

## Directory Layout on gh-pages Branch

```
gh-pages/
  versions.json              # Manifest (source of truth)
  index.html                 # Generated index page (derived from manifest)
  _shared/
    nav-widget.js            # Bundled nav widget (JS + injected CSS)
  v1.0.0/                    # Version subdirectory
    index.html               # Original content + injected script tag
    styles.css
    ...
  v1.1.0/
    index.html
    ...
  deploy_feature-x/
    index.html
    ...
```

The `_shared/` prefix convention (underscore) signals "not a version directory" and is unlikely to collide with user version names.

## Data Flow

```
1. CI triggers on matching ref (tag push, branch push)
2. CI builds static site output into ./build/
3. gh-pages-multiplexer invoked with:
   - build directory path
   - ref name (from CI environment)
   - ref pattern config (which refs to accept)

Pipeline:
  a. Ref Resolver: reads git log, extracts metadata -> DeploymentContext
  b. Branch Manager: fetches gh-pages, creates worktree -> working directory
  c. Manifest Manager: reads versions.json, adds/updates entry -> Manifest + updated file
  d. Content Placer: copies build/ into version subdirectory, injects script tags
  e. Index Generator: renders index.html from Manifest data
  f. Branch Manager: stages all changes, commits, pushes

4. GitHub Pages serves updated gh-pages branch
```

Every step always executes. When deploying a new version, the manifest gets a new entry. When redeploying an existing version, the manifest entry gets updated. The operations are identical; only the data varies. // [LAW:dataflow-not-control-flow]

## Suggested Build Order (Dependencies)

The components have clear dependency ordering for implementation:

```
Phase 1: Foundation
  Branch Manager (git operations are the foundation everything else depends on)
  Manifest Manager (core data contract, needed by everything downstream)

Phase 2: Core Pipeline
  Ref Resolver (extracts metadata that feeds the manifest)
  Content Placer (places files, depends on Branch Manager for working dir)

Phase 3: User-Facing
  Index Generator (depends on Manifest contract being stable)
  Nav Widget (standalone runtime artifact, depends on manifest contract only)

Phase 4: Integration
  CLI interface (wires pipeline together)
  GitHub Action wrapper (calls CLI)
```

**Rationale:**
- Branch Manager first because you cannot test anything without being able to manipulate the gh-pages branch
- Manifest Manager second because it defines the data contract that Index Generator and Nav Widget consume
- Content Placer and Ref Resolver are independent of each other but both depend on Phase 1
- Index Generator and Nav Widget only need a stable manifest contract, not the full pipeline
- CLI and Action wrapper are thin integration layers over the pipeline

## Scalability Considerations

| Concern | At 10 versions | At 100 versions | At 1000 versions |
|---------|---------------|-----------------|-------------------|
| Git clone size | Trivial | May want shallow fetch | Must use depth=1 + sparse checkout |
| versions.json size | Trivial (~1KB) | Manageable (~50KB) | Consider pagination in manifest or trimming old entries |
| Index page render | Instant | Fine with virtual scroll | Needs pagination or search/filter |
| Nav widget dropdown | Simple list | Grouped by major version | Searchable/filterable dropdown |
| Deploy time | Seconds | Seconds (only touches one subdir) | Seconds (only touches one subdir) |

Deploy time scales with version content size, not version count, because each deploy only touches one subdirectory + manifest + index. This is the correct architecture.

## Sources

- [mike (jimporter/mike)](https://github.com/jimporter/mike) -- Primary reference for versioned gh-pages architecture, versions.json manifest pattern
- [Material for MkDocs versioning setup](https://squidfunk.github.io/mkdocs-material/setup/setting-up-versioning/) -- How mike's version selector widget works
- [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) -- Reference for gh-pages git operations (force push, auth, branch management)
- [gh-pages-multi](https://github.com/koumoul-dev/gh-pages-multi) -- Lightweight multi-version gh-pages tool with auto-generated index
- [actions/deploy-pages](https://github.com/actions/deploy-pages) -- Official GitHub Pages deployment (artifact-based, not branch-based)
- [Creating a clean gh-pages branch (gist)](https://gist.github.com/ramnathv/2227408) -- Orphan branch creation pattern
- [Netherlands eScience Center blog on versioned docs](https://blog.esciencecenter.nl/versioned-documentation-using-only-github-actions-and-github-pages-1825296e31aa) -- GitHub Actions workflow for versioned documentation
