# Requirements: gh-pages-multiplexer

**Defined:** 2026-04-05
**Core Value:** Every deployment is preserved and browsable — users can access any version of their GitHub Pages site through a single, well-designed index.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Deployment

- [x] **DEPL-01**: Tool deploys build output into a versioned subdirectory on the gh-pages branch without disturbing existing version directories
- [x] **DEPL-02**: Version subdirectory name is derived from git ref (tag or branch name) by default
- [x] **DEPL-03**: User can configure glob/regex patterns to filter which branches or tags trigger versioned deployments
- [x] **DEPL-04**: Tool handles base path correction so deployed sites work correctly from their subdirectory (e.g., `<base href>` injection)
- [x] **DEPL-05**: Concurrent deployments to the same gh-pages branch do not corrupt each other (fetch-rebase-push retry or concurrency controls)

### Manifest

- [x] **MNFST-01**: A JSON manifest file at the root of gh-pages tracks all deployed versions as the single source of truth
- [ ] **MNFST-02**: Each manifest entry includes: version name, git ref, commit SHA, deploy timestamp, and commit history since last deployment
- [ ] **MNFST-03**: Manifest entries include author information and commit messages for each included commit
- [x] **MNFST-04**: Manifest is updated atomically with each deployment (same commit as the version content)

### Index Page

- [ ] **INDX-01**: An auto-generated index.html at the root of gh-pages displays all deployed versions
- [ ] **INDX-02**: Index page shows a timeline view of deployments with version name, date, and git ref
- [ ] **INDX-03**: Index page displays per-version commit history (commits that went into each deployment)
- [ ] **INDX-04**: Index page shows author information and commit metadata for each version
- [ ] **INDX-05**: Index page has a modern, well-designed UI that works on desktop and mobile
- [ ] **INDX-06**: Index page is regenerated on each deployment from the manifest

### Navigation Widget

- [ ] **NAVW-01**: A small floating UI element is injected into each deployed version's HTML pages at deploy time
- [ ] **NAVW-02**: Widget dynamically loads the manifest to display available versions
- [ ] **NAVW-03**: Widget allows navigating to any other version or back to the index
- [ ] **NAVW-04**: Widget uses Shadow DOM for style isolation from the host page
- [ ] **NAVW-05**: Widget is non-intrusive — does not break page layout or functionality

### GitHub Integration

- [x] **GHUB-01**: Tool is packaged as a GitHub Action consumable via `uses: owner/action@v1`
- [x] **GHUB-02**: Action accepts inputs: source directory, version name (optional, defaults to git ref), ref patterns, target branch
- [x] **GHUB-03**: Action works in standard GitHub Actions runner environment (Linux, git available, GITHUB_TOKEN)
- [ ] **GHUB-04**: Tool is also usable as a CLI (`npx gh-pages-multiplexer deploy`) for use in custom CI scripts
- [ ] **GHUB-05**: After deploying a PR preview, the Action posts a sticky comment on the PR with the preview URL

### Git Metadata

- [ ] **META-01**: At deploy time, tool extracts commit history between the current deployment and the previous deployment of the same version (or all commits if first deployment)
- [ ] **META-02**: Extracted metadata includes: commit SHA, author name/email, commit message, and timestamp for each commit
- [ ] **META-03**: All metadata is stored in the manifest and available to the index page and widget

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Version Management

- **VMGT-01**: Root URL redirects to a designated default version (e.g., "latest")
- **VMGT-02**: User can delete specific old versions from the gh-pages branch
- **VMGT-03**: User can create version aliases (e.g., `latest` → `v2.1.0`) without duplicating files
- **VMGT-04**: Configurable retention policy auto-deletes versions beyond a count or age threshold
- **VMGT-05**: Version sorting options (semver, date, alphabetical) on the index page

### Navigation Enhancements

- **NAVE-01**: Same-page cross-version navigation (switching versions preserves the current page path)
- **NAVE-02**: Outdated version banner warning when viewing a non-latest version

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| iframe-based version embedding | Unreliable across diverse page content; dropped in favor of injected nav |
| Preview thumbnails/screenshots | High complexity (needs headless browser), large storage, low value |
| Custom themes/branding for index | Premature customization; ship one good default first |
| Automatic changelog generation | Solved problem with dedicated tools (semantic-release, release-please); raw commits suffice |
| Build step integration | Tool deploys pre-built output only; coupling to build systems creates fragility |
| Authentication/access control | GitHub Pages is public; private previews need Netlify/Vercel |
| Multi-repo aggregation | Documentation platform feature, not deployment tool feature |
| Framework-specific integrations | Content-agnostic approach is the moat; no MkDocs/Docusaurus/Sphinx plugins |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPL-01 | Phase 1 | Complete |
| DEPL-02 | Phase 1 | Complete |
| DEPL-03 | Phase 1 | Complete |
| DEPL-04 | Phase 1 | Complete |
| DEPL-05 | Phase 1 | Complete |
| MNFST-01 | Phase 1 | Complete |
| MNFST-02 | Phase 2 | Pending |
| MNFST-03 | Phase 2 | Pending |
| MNFST-04 | Phase 1 | Complete |
| INDX-01 | Phase 3 | Pending |
| INDX-02 | Phase 3 | Pending |
| INDX-03 | Phase 3 | Pending |
| INDX-04 | Phase 3 | Pending |
| INDX-05 | Phase 3 | Pending |
| INDX-06 | Phase 3 | Pending |
| NAVW-01 | Phase 4 | Pending |
| NAVW-02 | Phase 4 | Pending |
| NAVW-03 | Phase 4 | Pending |
| NAVW-04 | Phase 4 | Pending |
| NAVW-05 | Phase 4 | Pending |
| GHUB-01 | Phase 1 | Complete |
| GHUB-02 | Phase 1 | Complete |
| GHUB-03 | Phase 1 | Complete |
| GHUB-04 | Phase 5 | Pending |
| GHUB-05 | Phase 5 | Pending |
| META-01 | Phase 2 | Pending |
| META-02 | Phase 2 | Pending |
| META-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation*
