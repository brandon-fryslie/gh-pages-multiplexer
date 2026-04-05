# Domain Pitfalls

**Domain:** GitHub Pages versioned deployment tooling
**Researched:** 2026-04-05

## Critical Pitfalls

Mistakes that cause data loss, broken deployments, or fundamental architecture rewrites.

### Pitfall 1: Force-Push Destroys Previous Versions

**What goes wrong:** Most existing gh-pages deployment tools use `git checkout --orphan` + `git push --force` on every deploy. This is fine when each deploy replaces the last, but it is catastrophic for a versioned deployment tool where the entire point is accumulating versions. A single force-push wipes every previously deployed version.

**Why it happens:** Developers copy patterns from existing deploy tools (like `peaceiris/actions-gh-pages` or `JamesIves/github-pages-deploy-action`) that assume replacement semantics. The orphan-branch-per-deploy pattern is deeply ingrained in the ecosystem.

**Consequences:** All previously deployed versions vanish. The manifest is gone. Users see only the latest version. Recovery requires re-deploying every version from source.

**Prevention:** Never force-push to the gh-pages branch. Always fetch the existing branch, add the new version directory on top, update the manifest, and do a normal (fast-forward) push. The deployment operation must be additive: clone/fetch gh-pages, add directory, commit, push.

**Detection:** Test with two sequential deploys. If the first version's directory is gone after the second deploy, the tool is using destructive push semantics.

**Phase:** Must be correct from the very first phase (core deployment). This is the foundational invariant of the entire tool.

### Pitfall 2: Concurrent Deployments Cause Non-Fast-Forward Rejection

**What goes wrong:** Two CI jobs trigger simultaneously (e.g., two tags pushed at once, or a tag and a branch deploy overlap). Both fetch the same gh-pages HEAD, both add their version directory, both try to push. The second push fails with "non-fast-forward" because the branch moved.

**Why it happens:** GitHub Actions can run workflows concurrently. Multiple tags or branches matching the deploy pattern can be pushed in quick succession. There is no built-in locking mechanism for branch pushes.

**Consequences:** Failed deployments that require manual re-triggering. In the worst case, if a tool catches the error and retries with force-push, it destroys the other deployment's work.

**Prevention:** Two-layer defense:
1. **GitHub Actions concurrency groups:** Use `concurrency: { group: "gh-pages-deploy", cancel-in-progress: false }` to serialize deployments at the workflow level. The `cancel-in-progress: false` is critical -- you want queuing, not cancellation.
2. **Fetch-rebase-push retry loop:** If the push fails with non-fast-forward, fetch the latest gh-pages, replay the version addition on top, and retry. Limit to 3-5 retries. This is the "reset-and-restore" pattern: save the new version to a temp dir, fetch latest gh-pages, copy version back in, commit, push.

**Detection:** Push two tags simultaneously in a test repo. If one deployment fails or overwrites the other, the concurrency handling is broken.

**Phase:** Core deployment phase. The retry logic must be built into the deploy command from the start, not bolted on later.

### Pitfall 3: Relative Path Breakage in Versioned Subdirectories

**What goes wrong:** A site built to be served from `/` or `/repo-name/` is instead served from `/repo-name/v1.0.0/`. Every absolute path (`/assets/style.css`, `/images/logo.png`) now points to the wrong location. Root-relative URLs resolve against `username.github.io/`, not against the version subdirectory.

**Why it happens:** Most static site generators and build tools assume their output will be served from a known base path. When you move that output into a subdirectory, root-relative paths break. The deployed site was never built with the subdirectory prefix in mind, and this tool explicitly cannot require users to rebuild with a different base path (it must be content-agnostic).

**Consequences:** Broken CSS, missing images, non-functional JavaScript, broken internal navigation. The deployed version looks completely broken even though the build output is correct.

**Prevention:** Inject a `<base href>` tag into each HTML file's `<head>` during deployment. The base href should be set to the version's subdirectory path (e.g., `<base href="/repo-name/v1.0.0/">`). This is a single-point fix that tells the browser to resolve all relative URLs against the correct base. This approach:
- Requires no changes to the user's build process
- Handles root-relative paths (`/assets/...`) correctly
- Is the least invasive transformation possible
- Has a known limitation: pages that already set `<base href>` will conflict (document this)

**Detection:** Deploy a site that uses root-relative asset paths (which is most sites). If CSS/JS/images load correctly from the versioned subdirectory, the base path handling works.

**Phase:** Core deployment phase. Without this, every deployed version appears broken.

### Pitfall 4: gh-pages Branch Bloat Over Time

**What goes wrong:** Every version deployment adds a full copy of the site's build output. Over months or years, the gh-pages branch accumulates hundreds of megabytes or gigabytes of static assets. Clone/fetch times for the branch become unacceptable. GitHub has a soft limit of 1GB and hard limit of 5GB per repository.

**Why it happens:** Each version is a complete, independent copy of the site. There is no deduplication between versions (git does some object-level dedup, but built assets like hashed JS bundles differ between versions). The gh-pages branch history also grows with each deployment commit.

**Consequences:** CI deployment times increase linearly. Eventually the repository hits GitHub's size limits. Clone operations time out. The tool becomes unusable on active projects.

**Prevention:**
1. **Shallow operations in CI:** Use `git clone --depth=1 --branch=gh-pages` when fetching the existing branch. The full history of the gh-pages branch is irrelevant; only the current tree matters.
2. **Version pruning command:** Provide a built-in mechanism to remove old versions (e.g., keep last N versions, or remove versions older than X days). This must update the manifest atomically with the directory removal.
3. **Squash commits on gh-pages:** Each deployment can optionally squash into a single commit on gh-pages, preventing commit history bloat. Or use `--amend` + force-push for the gh-pages branch commit history (this is safe because gh-pages history is not meaningful -- the versioned content is what matters, not the commit log of the gh-pages branch itself).
4. **Document size expectations:** Tell users approximately how much space each version will consume and what the practical limits are.

**Detection:** Monitor the size of the gh-pages branch after 10+ deployments. If clone time exceeds 30 seconds, bloat is becoming a problem.

**Phase:** Version pruning is a later phase feature, but shallow clone operations should be in the core deployment from the start.

## Moderate Pitfalls

### Pitfall 5: Manifest Corruption or Inconsistency

**What goes wrong:** The manifest file says a version exists but its directory is missing, or a directory exists but is not in the manifest. The index page shows phantom versions or misses real ones.

**Why it happens:** Non-atomic operations: the manifest is updated in a separate step from the directory creation. A failed deployment might create the directory but crash before updating the manifest (or vice versa). Manual intervention on the gh-pages branch can also cause drift.

**Prevention:** The manifest is the source of truth. Build the manifest from the actual directory listing at deployment time (verify what directories exist, then write the manifest). Alternatively, always write directory + manifest in a single commit so they cannot diverge. The manifest should be regenerable from the deployed directories plus git metadata.

**Detection:** Add a validation step that compares manifest entries against actual directories on the gh-pages branch. Run this as part of every deployment.

**Phase:** Core deployment. The manifest format and update logic must be correct from day one.

### Pitfall 6: GitHub Actions Shallow Clone Loses Git Metadata

**What goes wrong:** The tool needs to extract commit messages, authors, and history from the source repo to populate the manifest and index. But `actions/checkout` defaults to `fetch-depth: 1`, providing only the single triggering commit. The tool silently generates an index with minimal or missing metadata.

**Why it happens:** Performance optimization in CI. Shallow clones are the default because most CI jobs don't need history. The tool's documentation might not make this requirement clear, and the tool itself might not detect the shallow clone condition.

**Prevention:**
1. **Detect shallow clones:** Check `git rev-parse --is-shallow-repository` at the start of deployment. If true, warn the user clearly.
2. **Document fetch-depth requirement:** The GitHub Action's README must prominently state that `fetch-depth: 0` (or at least sufficient depth) is required for rich metadata.
3. **Graceful degradation:** If history is unavailable, still deploy successfully but with reduced metadata. Do not fail the deployment over missing metadata -- but do emit a visible warning.

**Detection:** Run the tool with default `actions/checkout` settings (fetch-depth: 1). If the index shows "1 commit" for every version regardless of actual history, this pitfall is active.

**Phase:** Core deployment for the detection/warning. Rich metadata extraction is a later feature but the depth requirement must be documented from the start.

### Pitfall 7: Injected Navigation Widget Breaks Existing Page Styles or Scripts

**What goes wrong:** The floating nav widget's CSS conflicts with the deployed site's styles. The widget's JavaScript conflicts with the page's JavaScript (variable name collisions, framework conflicts, event handler interference). The widget causes layout shifts or obscures critical content.

**Why it happens:** The tool injects foreign HTML/CSS/JS into arbitrary unknown pages. There is no way to predict what styles or scripts the target page uses. Global CSS selectors, z-index wars, and JavaScript global scope pollution are all likely.

**Prevention:**
1. **Shadow DOM isolation:** Render the widget inside a Shadow DOM element. This provides true CSS isolation -- the page's styles cannot leak in, and the widget's styles cannot leak out.
2. **Namespaced JavaScript:** Use an IIFE or ES module to avoid polluting the global scope. The widget should not add anything to `window` except possibly a single namespaced object.
3. **Minimal footprint:** The widget should be as small as possible -- a single floating button that expands on interaction. Avoid complex UI that competes with the page.
4. **Escape hatch:** Provide a URL parameter or manifest option to disable widget injection for specific versions.

**Detection:** Inject the widget into sites built with React, Vue, Tailwind, Bootstrap, and a plain HTML site. If any of them show visual glitches or JavaScript errors in the console, isolation is insufficient.

**Phase:** Widget injection phase. This is the phase where this pitfall is relevant, but the Shadow DOM decision should be made upfront during architecture.

### Pitfall 8: GitHub Pages Custom Domain + Repository Path Mismatch

**What goes wrong:** The tool hardcodes paths assuming the site is served at `username.github.io/repo-name/`. But if the repo uses a custom domain (served at `custom.domain.com/`), the base paths are wrong. Or if it is the user's `username.github.io` repo, there is no repo-name prefix.

**Why it happens:** GitHub Pages has three URL patterns:
- User/org site: `username.github.io/` (no repo prefix)
- Project site: `username.github.io/repo-name/`
- Custom domain: `customdomain.com/` (no repo prefix)

The tool must handle all three, and the version subdirectory path differs in each case.

**Prevention:** Detect the deployment context:
1. Check for a `CNAME` file on the gh-pages branch (indicates custom domain).
2. Check if the repository name is `username.github.io` (indicates user/org site).
3. Otherwise, assume project site with `/repo-name/` prefix.
4. Allow explicit override via configuration for edge cases.

All path generation (base href injection, manifest URLs, widget asset paths) must use this detected or configured base path.

**Detection:** Test deployment in all three GitHub Pages configurations. If links break in any configuration, path detection is wrong.

**Phase:** Core deployment. Path calculation affects everything downstream.

## Minor Pitfalls

### Pitfall 9: Version Name Sanitization

**What goes wrong:** Branch names like `feature/my-thing` or tag names with special characters create directory names that are problematic in URLs or file systems. Slashes create nested directories. Spaces break URLs. Unicode causes encoding issues.

**Prevention:** Sanitize version names: replace `/` with `--`, strip or encode special characters, enforce a maximum length. Document the sanitization rules so users can predict the output directory name. Store both the original ref name (in the manifest) and the sanitized directory name.

**Phase:** Core deployment.

### Pitfall 10: GitHub Pages Build Pipeline Interference

**What goes wrong:** When the gh-pages branch is configured as the publishing source, GitHub runs its own build pipeline (Jekyll by default) on the branch contents. Jekyll processing can mangle HTML files, ignore files starting with `_`, or add unexpected transformations.

**Prevention:** Include a `.nojekyll` file in the root of the gh-pages branch. This tells GitHub Pages to serve files as-is without Jekyll processing. The tool must ensure this file exists after every deployment.

**Detection:** Deploy a site with a directory named `_assets` or a file named `_config.yml`. If they are missing or transformed in the served site, Jekyll processing is interfering.

**Phase:** Core deployment. The `.nojekyll` file must be present from the first deployment.

### Pitfall 11: CNAME File Deletion on Deploy

**What goes wrong:** Custom domain configuration is stored as a `CNAME` file on the gh-pages branch root. A deployment that rebuilds the root of gh-pages can accidentally delete this file, causing the custom domain to disconnect.

**Prevention:** Before writing any files, check for an existing `CNAME` file and preserve it. The deployment operation should be purely additive to the root -- only add/update the version directory, manifest, index, and widget assets. Never delete files from the root unless explicitly managing a version removal.

**Phase:** Core deployment.

### Pitfall 12: Widget Manifest Fetch Path

**What goes wrong:** The injected navigation widget needs to fetch the manifest file to populate its version list. If the manifest URL is hardcoded with the wrong base path, or uses a relative path that resolves incorrectly from within a version subdirectory, the widget silently fails to load version data.

**Prevention:** The widget should resolve the manifest path relative to the site root, not relative to the current page. Use the same base-path detection logic as the rest of the tool. The manifest URL in the widget should be an absolute path from the site root (e.g., `/repo-name/manifest.json`), not a relative path.

**Phase:** Widget injection phase, but the manifest location and URL scheme should be decided during architecture.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Core deployment | Force-push destroying versions (P1) | Additive-only push strategy from day one |
| Core deployment | Concurrent deploy conflicts (P2) | Concurrency groups + retry loop |
| Core deployment | Relative path breakage (P3) | Base href injection |
| Core deployment | Jekyll interference (P10) | .nojekyll file |
| Core deployment | CNAME deletion (P11) | Preserve existing root files |
| Core deployment | Path detection for repo types (P8) | Detect user/project/custom-domain context |
| Manifest/metadata | Shallow clone metadata loss (P6) | Detect and warn, document fetch-depth |
| Manifest/metadata | Manifest inconsistency (P5) | Single-commit atomic updates |
| Widget injection | Style/script conflicts (P7) | Shadow DOM isolation |
| Widget injection | Manifest fetch path (P12) | Absolute path from site root |
| Maintenance features | Branch bloat (P4) | Shallow clone ops + version pruning |
| Version naming | Unsafe directory names (P9) | Sanitization rules |

## Sources

- [GitHub community: gh-pages branch bloat from 40M to 1538M](https://github.com/mozilla-mobile/mozilla-vpn-client/issues/2479) - Real-world bloat example (Confidence: HIGH)
- [GitHub community: 13GB repo cleanup with gh-pages](https://github.com/orgs/community/discussions/58794) - Bloat cleanup strategies (Confidence: HIGH)
- [Fixing concurrent GitHub Actions workflows](https://bruno.verachten.fr/2025/11/20/fixing-concurrent-github-actions-workflows-multi-architecture-package-repository-guide/) - Reset-and-restore pattern for concurrent branch updates (Confidence: HIGH)
- [GitHub Docs: Concurrency control](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) - Official concurrency group documentation (Confidence: HIGH)
- [GitHub Docs: Non-fast-forward errors](https://docs.github.com/en/get-started/using-git/dealing-with-non-fast-forward-errors) - Official documentation (Confidence: HIGH)
- [GitHub community: CORS headers on GitHub Pages](https://github.com/orgs/community/discussions/157852) - Cannot configure CORS headers, all public content served with `Access-Control-Allow-Origin: *` (Confidence: HIGH)
- [GitHub Pages relative path fixes](https://www.pluralsight.com/resources/blog/guides/fixing-broken-relative-links-on-github-pages) - Base URL and relative path issues (Confidence: HIGH)
- [GitHub Pages base path for project sites](https://devactivity.com/posts/apps-tools/mastering-github-pages-configure-base-paths-for-seamless-project-deployments/) - Base href approach (Confidence: MEDIUM)
- [GitHub Pages SPA 404 fix](https://devactivity.com/posts/apps-tools/unlocking-spa-deployment-solving-github-pages-404s-for-enhanced-engineering-productivity/) - Subdirectory routing issues (Confidence: MEDIUM)
- [actions/checkout documentation](https://github.com/actions/checkout) - Default fetch-depth: 1 behavior (Confidence: HIGH)
- [Creating a clean gh-pages branch](https://gist.github.com/ramnathv/2227408) - Orphan branch pattern (Confidence: HIGH)
