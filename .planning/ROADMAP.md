# Roadmap: gh-pages-multiplexer

## Overview

This roadmap delivers a content-agnostic GitHub Action that transforms GitHub Pages from single-deployment to multi-version. The journey starts with reliable versioned deployment mechanics (the foundational invariant), layers in git metadata extraction, builds the user-facing index page and navigation widget as independent features, and finishes with CLI access and PR workflow integration.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core Deployment Pipeline** - Versioned subdirectory deployment as a working GitHub Action with manifest tracking
- [ ] **Phase 2: Git Metadata Extraction** - Rich commit history, authors, and timestamps captured into the manifest at deploy time
- [ ] **Phase 3: Rich Index Page** - Auto-generated root page displaying all versions with timeline, metadata, and modern UI
- [ ] **Phase 4: Navigation Widget** - Floating version switcher injected into deployed pages with Shadow DOM isolation
- [ ] **Phase 5: CLI and PR Integration** - CLI fallback for custom workflows and PR preview comments

## Phase Details

### Phase 1: Core Deployment Pipeline
**Goal**: Users can deploy any static site into a versioned subdirectory on gh-pages without destroying previous deployments
**Depends on**: Nothing (first phase)
**Requirements**: DEPL-01, DEPL-02, DEPL-03, DEPL-04, DEPL-05, MNFST-01, MNFST-04, GHUB-01, GHUB-02, GHUB-03
**Success Criteria** (what must be TRUE):
  1. User can add the Action to a workflow and deploy a build directory to a named version subdirectory on gh-pages
  2. Deploying a new version preserves all previously deployed version directories unchanged
  3. A JSON manifest at the gh-pages root tracks every deployed version and is updated in the same commit as the version content
  4. Deployed sites render correctly from their subdirectory (links, assets, styles all work)
  5. Two concurrent workflow runs deploying different versions both succeed without corrupting each other
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffold: package.json, TypeScript, Rollup, Vitest, action.yml, types, entry point stub
- [x] 01-02-PLAN.md — Core logic modules: ref-resolver, base-path, content-placer, manifest-manager with tests
- [x] 01-03-PLAN.md — Git operations (branch-manager), full pipeline wiring, integration test, dist/index.js build

### Phase 2: Git Metadata Extraction
**Goal**: Each deployment automatically captures and stores rich git history so downstream features (index, widget) have data to display
**Depends on**: Phase 1
**Requirements**: META-01, META-02, META-03, MNFST-02, MNFST-03
**Success Criteria** (what must be TRUE):
  1. After deploying, the manifest entry for that version contains the list of commits since the previous deployment of that version (or all commits if first deployment)
  2. Each commit in the manifest includes SHA, author name/email, commit message, and timestamp
  3. The manifest is the single source of all version metadata -- no other files store deployment history
**Plans**: TBD

Plans:
- [x] 02-01: TBD
- [x] 02-02: TBD

### Phase 3: Rich Index Page
**Goal**: Users landing on the root gh-pages URL see a well-designed page listing all deployed versions with their history and metadata
**Depends on**: Phase 2
**Requirements**: INDX-01, INDX-02, INDX-03, INDX-04, INDX-05, INDX-06
**Success Criteria** (what must be TRUE):
  1. Visiting the root gh-pages URL shows an auto-generated index listing all deployed versions
  2. Index displays a timeline view with version name, deployment date, and git ref for each version
  3. Expanding or viewing a version shows its commit history with author names and commit messages
  4. Index page is readable and functional on both desktop and mobile browsers
  5. Index is regenerated on each deployment -- adding a new version automatically appears on the index
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Navigation Widget
**Goal**: Users browsing any deployed version can switch to another version or return to the index without leaving the page
**Depends on**: Phase 1
**Requirements**: NAVW-01, NAVW-02, NAVW-03, NAVW-04, NAVW-05
**Success Criteria** (what must be TRUE):
  1. Every HTML page in a deployed version contains a small floating UI element for version navigation
  2. The widget loads the manifest and displays all available versions
  3. Clicking a version in the widget navigates to that version; clicking "index" returns to the root page
  4. The widget does not break the layout, styling, or functionality of any host page (verified on pages with various CSS frameworks)
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: CLI and PR Integration
**Goal**: Users can invoke the tool from custom CI scripts and get automatic PR preview links
**Depends on**: Phase 1
**Requirements**: GHUB-04, GHUB-05
**Success Criteria** (what must be TRUE):
  1. User can run `npx gh-pages-multiplexer deploy` from within any CI environment to deploy a version
  2. When deploying from a PR workflow, the Action posts a sticky comment on the PR with the preview URL
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Deployment Pipeline | 0/3 | Planned | - |
| 2. Git Metadata Extraction | 0/2 | Not started | - |
| 3. Rich Index Page | 0/3 | Not started | - |
| 4. Navigation Widget | 0/2 | Not started | - |
| 5. CLI and PR Integration | 0/2 | Not started | - |
