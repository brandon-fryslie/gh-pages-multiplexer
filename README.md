# gh-pages-multiplexer

Deploy static sites to **versioned subdirectories** on a `gh-pages` branch without destroying previous deployments. Get a rich auto-generated index page, a floating version-switcher widget on every deployed page, and PR preview comments — all from a single GitHub Action or CLI invocation.

```
your-site.github.io/your-repo/
├── index.html          ← auto-generated timeline of all versions
├── versions.json       ← manifest with commit history per version
├── v1.0.0/             ← preserved
├── v2.0.0/             ← preserved
├── v2.1.0/             ← newest deploy
└── pr-42/              ← PR previews
```

Every deployed page gets a small floating nav widget (Shadow-DOM-isolated) so users can jump between versions or back to the index without leaving the site. A page framed by a same-origin page that already runs the same site's widget leaves it to that page, so a live demo in an iframe never shows a second one.

---

## Features

- **Non-destructive multi-version deploys** — preserves all previous version subdirectories
- **Concurrent-run safety** — a deploy that loses a push race rebuilds on the winner's commit and retries, so simultaneous runs all land
- **Auto-generated index page** — responsive timeline with light/dark mode, commit history per version, zero JS
- **Floating navigation widget** — Shadow DOM isolation, can't be broken by host-page CSS
- **Git metadata capture** — commit SHA / author / message / timestamp stored in the manifest per deploy
- **PR sticky preview comments** — one comment per PR, idempotently upserted across reruns
- **Base-path rewriting** — two modes (`base-tag`, `rewrite`) so deep relative assets resolve correctly from subdirectories
- **Ref pattern filtering** — deploy only tags matching `v*`, or only certain branches
- **CLI fallback** — use `npx gh-pages-multiplexer deploy` from any CI environment, not just GitHub Actions

---

## Install via agent (recommended)

If you're using a coding agent (Claude Code, Cursor, Aider, Copilot, etc.), point it at **[AGENT_INSTALL.md](./AGENT_INSTALL.md)** and let it detect your build system, match your existing workflow conventions, and wire everything up:

> *"Follow the instructions at https://github.com/brandon-fryslie/gh-pages-multiplexer/blob/v1/AGENT_INSTALL.md"*

The agent will inspect your repo, pick the right output directory, integrate with existing workflows if any, and enable GitHub Pages in the repo settings.

---

## Quick start (GitHub Action, manual)

Add a workflow at `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    tags: ['v*']
  pull_request:

# One group per ref, so a run for one slot can't cancel a pending deploy of another (see Concurrent runs)
concurrency:
  group: pages-deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # needed to push to gh-pages
      pull-requests: write   # needed for PR preview comments
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # required — git metadata extraction needs full history

      - name: Build site
        run: |
          # your build command here — the tool is content-agnostic
          npm ci
          npm run build       # produces ./dist

      - uses: brandon-fryslie/gh-pages-multiplexer@v1
        with:
          source-dir: dist
          base-path-mode: rewrite
```

On every push of a `v*` tag, the built site lands at `https://<owner>.github.io/<repo>/<tag>/` and the index page is regenerated. On every PR, a preview lands at `.../pr-<number>/` and a sticky comment appears on the PR with the link.

---

## Action inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `source-dir` | **yes** | — | Directory containing built site to deploy (e.g. `dist`, `public`, `_site`) |
| `target-branch` | no | `gh-pages` | Branch to deploy to |
| `ref-patterns` | no | *(all refs)* | Comma-separated glob patterns; skip deploy if current ref doesn't match (e.g. `v*,main,feature/**`). Matched against the branch or tag name, or `pr-<number>` for a pull request; `*` stops at `/` and `**` crosses it. Bypassed when `version` is set. |
| `base-path-mode` | no | `base-tag` | How to make deep relative assets resolve. `base-tag` injects `<base href>`. `rewrite` rewrites `href`/`src` attributes directly. `none` skips rewriting entirely — use this when your build already sets the correct absolute base URL at build time. |
| `base-path-prefix` | no | *(auto)* | Override repo base path. Auto-detected from `GITHUB_REPOSITORY` when unset. |
| `version` | no | *(auto)* | Explicit version slot name (e.g. `v1.2.3`). When set, overrides the ref-derived slot and bypasses `ref-patterns` filtering. Required when pairing with `base-path-mode: none` so your build can compute the exact matching base URL. |
| `widget-icon` | no | layers icon | Custom SVG markup for the navigation widget icon. Must be a complete `<svg>...</svg>` element. |
| `widget-label` | no | `{version}` | Label text shown on the widget handle when hovered. Supports the `{version}` token. |
| `widget-position` | no | `right 80%` | Where the widget tab appears, in the form `<edge> <vertical%>`. Edge is `right` or `left`. Vertical is a percentage from the top. |
| `widget-color` | no | `#f97316` | Hex color for the widget handle background. |
| `token` | no | `${{ github.token }}` | Token with `contents: write` on the target branch |

### Build-time base URL (recommended for SPAs and SSGs)

If your build tool supports setting an absolute base URL at build time (Vite `base`, Next.js `basePath`, Astro `base`, SvelteKit `paths.base`, etc.), the **most reliable path** is to let your build emit correct URLs and tell this action to skip rewriting:

```yaml
- name: Compute version
  id: version
  run: echo "slot=${GITHUB_REF_NAME}" >> "$GITHUB_OUTPUT"

- name: Build with explicit base URL
  env:
    # Adapt to your build tool:
    VITE_BASE: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}/
    # NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}
    # ASTRO_BASE: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}/
  run: npm run build

- uses: brandon-fryslie/gh-pages-multiplexer@v1
  with:
    source-dir: dist
    version: ${{ steps.version.outputs.slot }}
    base-path-mode: none
```

Why this is better than `base-tag` / `rewrite`: your build tool already knows about every asset, every dynamic import, every CSS `url(...)`, and every framework-specific URL helper (`next/image`, Vite asset hashing, etc). Rewriting the emitted HTML after the fact can miss assets that aren't plain `href` / `src` attributes. Letting the build set the base URL and telling this action `none` means zero post-hoc mutation — the files deployed are byte-for-byte the files your build produced.

### Customizing the widget

The floating navigation widget is fully customizable. All widget inputs are optional — defaults are sane.

```yaml
- uses: brandon-fryslie/gh-pages-multiplexer@v1
  with:
    source-dir: dist
    widget-icon: |
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    widget-label: "Docs {version}"
    widget-position: "left 50%"
    widget-color: "#10b981"
```

Notes:
- **`widget-icon`** accepts any complete `<svg>` element. The SVG inherits the handle's foreground color via `currentColor`, so use `stroke="currentColor"` or `fill="currentColor"` for your paths.
- **`widget-label`** supports a single `{version}` token that's replaced with the deployed version slot at runtime (e.g. `Docs {version}` → `Docs v1.2.3`). The label is hidden in the closed state and revealed on hover.
- **`widget-position`** is `<edge> <vertical%>` — `edge` is `right` (default) or `left`, `vertical` is a percentage `0%`–`100%` from the top of the viewport. The handle's vertical center sits on this line. Recommended range: `20%`–`80%` so the panel doesn't extend past the viewport edges when opened.
- **`widget-color`** is the handle background. Foreground (icon + label) is white. Hover darkens via CSS `filter: brightness(0.92)` so the same color works without specifying a separate hover shade.
- The widget inputs apply to the whole site: every deploy re-renders the widget in every version with its own inputs. Give every workflow that deploys to the same branch the same widget inputs, or each deploy restyles every version to match itself.

## Action outputs

| Output | Description |
|---|---|
| `version` | The deployed version name (sanitized from the git ref) |
| `url` | The full URL of the deployed version |

---

## CLI usage

```bash
# Install globally
npm install -g gh-pages-multiplexer

# Or run ad-hoc with npx
npx gh-pages-multiplexer deploy --help
```

Example — deploy a tagged release from a custom CI script:

```bash
export GITHUB_TOKEN=$(gh auth token)

npx gh-pages-multiplexer deploy \
  --source-dir=dist \
  --repo=owner/repo \
  --ref=refs/tags/v1.2.3 \
  --base-path-mode=rewrite
```

### CLI flags

| Flag | Description |
|---|---|
| `--source-dir=<path>` | Built site directory (required) |
| `--target-branch=<name>` | Target gh-pages branch (default: `gh-pages`) |
| `--ref-patterns=<csv>` | Comma-separated globs matched against the branch or tag name, or `pr-<number>` (bypassed when `--deploy-version` is set) |
| `--base-path-mode=<mode>` | `base-tag`, `rewrite`, or `none` (default: `base-tag`) |
| `--base-path-prefix=<prefix>` | Override auto-detected base path |
| `--repo=<owner/name>` | Repository slug (default: `$GITHUB_REPOSITORY`) |
| `--ref=<refs/...>` | Git ref to deploy (default: `$GITHUB_REF`) |
| `--deploy-version=<name>` | Explicit version slot (overrides ref-derived name; required for `--base-path-mode=none`) |
| `--widget-icon=<svg>` | Custom SVG markup for the widget icon |
| `--widget-label=<text>` | Widget label, supports `{version}` token |
| `--widget-position=<spec>` | Widget location: `<edge> <vertical%>` (e.g. `right 80%`) |
| `--widget-color=<hex>` | Hex color for the widget handle background |
| `--debug` | Print full stack traces on error |

### Environment variables

| Var | Purpose |
|---|---|
| `GITHUB_TOKEN` | GitHub token with `contents: write` (preferred) |
| `GH_TOKEN` | Fallback token env var — matches `gh` CLI convention |
| `DEBUG=1` | Equivalent to `--debug` |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Deployment failure (git/network/push error) |
| `2` | Configuration error (missing inputs, bad flags, missing token) |

Note: the CLI never posts PR preview comments — that's an Action-only feature because it needs GitHub event context.

---

## How versions are named

The version subdirectory is derived from the git ref (or the `version` input), sanitized so the name is safe both as a directory and as a URL path segment. Letters, digits, `.`, `_`, `~`, `@`, `+` and `-` are kept, and every other character is written as `~XX` for each of its UTF-8 bytes (percent-encoding with `~` in place of `%`), so no character is dropped and non-ASCII refs keep their names. A `/` still becomes `-`, so `feature/auth` and `feature-auth` share a version. A name that matches, ignoring case, one of the entries the action keeps at the branch root (`versions.json`, `_versions`, `index.html`, `robots.txt`, `sitemap.xml`, `_health.json`, `CNAME`) has its first character escaped too, so a version never overwrites one of them:

| Ref | Version directory |
|---|---|
| `refs/tags/v1.2.3` | `v1.2.3/` |
| `refs/heads/main` | `main/` |
| `refs/heads/feature/auth` | `feature-auth/` |
| `refs/pull/42/merge` | `pr-42/` *(set via `version-ref` in workflow)* |
| `refs/tags/@scope/pkg@1.0.0` | `@scope-pkg@1.0.0/` |
| `refs/tags/v1#rc` | `v1~23rc/` |
| `refs/heads/docs/日本` | `docs-~E6~97~A5~E6~9C~AC/` |
| `refs/tags/_versions` | `~5Fversions/` |

A version deployed by an earlier release under a name that no longer passes this rule (such as `v1#rc/`) is renamed the next time anything deploys. Its directory moves, the `src` and `href` URLs its pages carry under the old base path move to the new one, and the rename is printed in the deploy summary with the number of pages rebased. Links to the old name stop resolving. A version deployed as `_versions` shared its directory with the version index, which overwrote its `index.html`; renamed to `~5Fversions/`, it keeps a stale copy of the index and `stats.html` until its ref is deployed again. If two deployed versions would end up with the same name, the deploy fails and names both.

Redeploying the same ref replaces that version subdirectory atomically — the new commit history is appended to the manifest entry.

---

## Base-path correction

Deep relative assets (`<img src="./logo.png">`, `background: url(../bg.png)`) break when a site is served from `/repo/v1.0.0/` instead of `/`. This tool handles it in two ways:

- **`base-tag`** (default): injects `<base href="/repo/v1.0.0/">` into every HTML page's `<head>`. Browser does the rest.
- **`rewrite`**: rewrites absolute paths in `href` / `src` attributes directly. More invasive, but works even when the host page already sets its own `<base>`.

Pick `rewrite` if you're shipping a SPA or a site with pre-existing `<base href>` tags. Otherwise `base-tag` is simpler and faster.

---

## The manifest: `versions.json`

Stored at the root of the `gh-pages` branch. Single source of truth for all versions. Schema:

```jsonc
{
  "schema": 2,
  "versions": [
    {
      "version": "v1.2.3",
      "ref": "refs/tags/v1.2.3",
      "sha": "abcdef1234...",
      "timestamp": "2026-04-06T12:00:00Z",
      "commits": [
        {
          "sha": "abcdef1234...",
          "author_name": "Alice",
          "author_email": "alice@example.com",
          "message": "Release v1.2.3",
          "timestamp": "2026-04-06T11:55:00Z"
        }
        // ... up to 100 commits since the previous deploy
      ]
    }
    // ... newer first
  ]
}
```

Schema `1` entries (from older deployments) are still readable — the tool auto-upgrades to `2` on the next write.

---

## Requirements

- **Node 24+** on the runner (GitHub-hosted runners support it by default)
- **`fetch-depth: 0`** on `actions/checkout` — the git metadata extractor needs full history to compute commit ranges. Without it, the action fails loudly with a clear error message.
- **`permissions.contents: write`** on the workflow to push to `gh-pages`
- **`permissions.pull-requests: write`** if you want PR preview comments (optional — the deploy itself succeeds without this permission, you just won't get the sticky comment)

---

## Navigation widget

Every deployed HTML page gets a small floating button in the bottom-right corner. Clicking it opens a panel listing all deployed versions, with a "← Index" link back to the root index page.

The widget is injected as a single `<script>` tag before `</body>`, wraps everything in a Shadow DOM (`mode: 'open'`, `:host { all: initial }`), and fetches the site's root `versions.json` lazily on first open, from a page at any depth in its version. Every deploy re-renders that tag into every version listed in `versions.json`, so pages deployed by an older release of this action pick up the current widget — and the current widget inputs — on the next deploy of any version. **It cannot be broken by host-page CSS** — not even aggressive resets with `color: red !important` on everything.

To opt out: don't use this tool. There's no configuration knob to disable injection in v1 — the widget is the point.

---

## Concurrent runs

Give each ref its own `concurrency` group:

```yaml
concurrency:
  group: pages-deploy-${{ github.ref }}
  cancel-in-progress: false
```

By default a GitHub concurrency group holds at most one run in progress and one pending. When another run is queued, GitHub cancels the pending one and queues the new run in its place; `cancel-in-progress: false` does not stop this, it only spares the run already in progress. With one group shared by every ref, a pull request run queued behind a `main` deploy cancels that deploy, and the merged change never ships. A group per ref limits the cancellation to runs for the same slot, where the newest run carries the latest content anyway.

Runs for different slots then execute at the same time and race to push `gh-pages`, as do CLI deploys from several machines. The tool handles that race with **optimistic concurrency**: each attempt builds the whole deploy — `versions.json`, the version directory, and every file derived from the manifest (index, sitemap, robots, health, SEO tags) — on a fresh checkout of the current `gh-pages` tip, then pushes without force. If another run pushed first, the push is rejected and the attempt starts over from the new tip. Every lost race means another deploy published, so a burst of N simultaneous deploys all land, each within N attempts. A deploy keeps rebuilding for as long as other pushes keep moving the tip, logging a warning per lost race; in Actions the job's `timeout-minutes` ends it, and a CLI deploy runs until interrupted. A rejection after which the tip has not moved is not a lost race. It means the push went somewhere other than where the tip was read (for example a `url.*.pushInsteadOf` rewrite), and the deploy fails at once, naming the tip and git's rejection. Any other git failure fails the deploy. The log line `Deployed <name> as <version> to <url> (<outcome>, N publish attempt(s); nav widget I inserted, R refreshed, C current)` shows the version directory the ref (or the `version` input, when set) was named to, whether a commit was published (`pushed`) or the branch already matched (`unchanged`), how many attempts it took, and how many pages across all versions got the widget for the first time, had an older widget replaced, or already carried the current one.

---

## Troubleshooting

**"Previous SHA not reachable (shallow clone)"** — your `actions/checkout` step needs `fetch-depth: 0`. Git metadata extraction requires full history.

**PR comment doesn't appear** — check that the workflow has `permissions.pull-requests: write`. If the action logs `403 from GitHub API`, the permission is missing. The deploy itself still succeeds — the comment is optional.

**Deployed site 404s on CSS/JS** — try `base-path-mode: rewrite` instead of the default `base-tag`. Some hosts (or sites that set their own `<base href>`) need direct URL rewriting.

**Widget doesn't load version list** — check the browser's network tab; the widget fetches `versions.json` at the site root (the path above the version directory). If you moved the manifest (don't — the tool writes it at the gh-pages root), update your workflow.

---

## Architecture notes

The pipeline is a fixed sequence — every deploy runs the same stages in the same order:

```
parseInputs
    ↓
resolveRef              (ref pattern match + version slot)
    ↓
extractCommits          (git log previousSha..currentSha, capped at 100)
    ↓
withWorktree            (fetch gh-pages tip, create worktree)
    ↓
placeContent            (rsync source-dir → workdir/versionSlot/)
    ↓
injectWidget            (walk *.html of every version, place the current script tag before </body>)
    ↓
renderIndexHtml         (regenerate root index.html from manifest)
    ↓
writeManifest           (update versions.json atomically)
    ↓
commitAndPush           (one atomic commit; on a stale tip, rebuild on a fresh worktree)
    ↓
upsertPreviewComment    (only in PR context, Action only)
```

No conditional stages. No `if PR ...` branches. Stages that aren't relevant are no-ops on empty data.

---

## Why the `gh-pages` branch instead of the newer Actions-based Pages deployment?

GitHub Pages supports two deployment sources: **branch source** (serve files from a branch like `gh-pages`) and **Actions source** (upload a site artifact via `actions/deploy-pages`). This tool uses branch source deliberately — it's the right fit for the problem, not legacy inertia.

**The fundamental mismatch**: `actions/deploy-pages` is a *total-replacement* model. Each deploy uploads one artifact that replaces the entire live site atomically. There's no concept of "merge this version into existing content" — every publish wipes and replaces.

This tool's whole purpose is **accumulation**: `v1/`, `v2/`, `pr-42/`, `main/`, `feature-foo/` all coexist on the same Pages site and persist across deploys. That maps naturally to branch source semantics (commits are additive, git provides concurrency control and history) and fights Actions source semantics (every deploy replaces everything).

**What it would cost to switch.** To use `actions/deploy-pages`, every deploy would need to: (1) download the previous artifact, (2) extract it, (3) merge the new version subdir + updated manifest, (4) upload the *entire accumulated site* as a new artifact. Problems:

- **Size grows unboundedly** — after 50 versions, each deploy re-uploads gigabytes. Branch model only commits the diff.
- **No atomic concurrency** — branch model uses a non-force push as a compare-and-swap on the branch tip, rebuilding and retrying on a lost race. Actions source has no equivalent; parallel deploys would race and one would lose.
- **State has to live somewhere** — the branch *is* the state store. Without it you'd either keep the branch anyway (just not serve from it) or trust the previous artifact is always retrievable (it isn't — artifacts have retention policies).
- **No git history as audit trail** — today `git log gh-pages` tells you exactly what was deployed, when, and by whom.

**What Actions source does give you.** For single-version sites, real advantages: deploy status integrated into GitHub's Deployments UI, tighter security (branch source lets anyone with push access to `gh-pages` publish; Actions source is gated by workflow permissions), cleaner separation between source and published artifacts. Those benefits are already well-served by using `actions/deploy-pages` directly — no multiplexer needed.

**Bottom line**: pick the infrastructure whose native semantics match your problem. Branch source's "accumulative commits" invariant lines up with this tool's "versions coexist" invariant. Forcing accumulation onto a replacement-oriented API would add complexity without solving anything this tool's users actually need.

---

## Development

```bash
git clone https://github.com/brandon-fryslie/gh-pages-multiplexer
cd gh-pages-multiplexer
pnpm install
pnpm test             # typechecks src and tests (tsc), then runs the vitest suite
pnpm run build        # produces dist/index.js (Action) and dist/cli.js (CLI)
pnpm run check:dist   # rebuilds dist/ and fails if it differs from what is committed
```

Tests use real git fixtures and real filesystem operations — no mocks of git or fs. Build is a Rollup bundle; the `dist/` directory is checked in so the Action can be consumed via `uses: owner/repo@v1` without a build step on the consumer side. Commit the rebuilt `dist/` with every change to `src/` or the lockfile; CI runs `check:dist` and fails when they disagree.

---

## License

MIT
