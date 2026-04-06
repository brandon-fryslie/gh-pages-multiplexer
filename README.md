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

Every deployed page gets a small floating nav widget (Shadow-DOM-isolated) so users can jump between versions or back to the index without leaving the site.

---

## Features

- **Non-destructive multi-version deploys** — preserves all previous version subdirectories
- **Concurrent-run safety** — fetch-rebase-push retry handles races between simultaneous workflow runs
- **Auto-generated index page** — responsive timeline with light/dark mode, commit history per version, zero JS
- **Floating navigation widget** — Shadow DOM isolation, can't be broken by host-page CSS
- **Git metadata capture** — commit SHA / author / message / timestamp stored in the manifest per deploy
- **PR sticky preview comments** — one comment per PR, idempotently upserted across reruns
- **Base-path rewriting** — two modes (`base-tag`, `rewrite`) so deep relative assets resolve correctly from subdirectories
- **Ref pattern filtering** — deploy only tags matching `v*`, or only certain branches
- **CLI fallback** — use `npx gh-pages-multiplexer deploy` from any CI environment, not just GitHub Actions

---

## Quick start (GitHub Action)

Add a workflow at `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    tags: ['v*']
  pull_request:

# Serialize concurrent runs so the rebase-retry path is rarely exercised
concurrency:
  group: pages-deploy
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
| `ref-patterns` | no | `*` | Comma-separated glob patterns; skip deploy if current ref doesn't match (e.g. `v*,main`) |
| `base-path-mode` | no | `base-tag` | How to make deep relative assets resolve from the subdirectory. `base-tag` injects `<base href>`. `rewrite` rewrites `href`/`src` attributes directly. |
| `base-path-prefix` | no | *(auto)* | Override repo base path. Auto-detected from `GITHUB_REPOSITORY` when unset. |
| `token` | no | `${{ github.token }}` | Token with `contents: write` on the target branch |

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
| `--ref-patterns=<csv>` | Comma-separated ref patterns to deploy |
| `--base-path-mode=<mode>` | `base-tag` or `rewrite` (default: `base-tag`) |
| `--base-path-prefix=<prefix>` | Override auto-detected base path |
| `--repo=<owner/name>` | Repository slug (default: `$GITHUB_REPOSITORY`) |
| `--ref=<refs/...>` | Git ref to deploy (default: `$GITHUB_REF`) |
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

The version subdirectory is derived from the git ref, sanitized to be filesystem-safe:

| Ref | Version directory |
|---|---|
| `refs/tags/v1.2.3` | `v1.2.3/` |
| `refs/heads/main` | `main/` |
| `refs/heads/feature/auth` | `feature-auth/` |
| `refs/pull/42/merge` | `pr-42/` *(set via `version-ref` in workflow)* |

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

- **Node 20+** on the runner (GitHub-hosted runners are fine by default)
- **`fetch-depth: 0`** on `actions/checkout` — the git metadata extractor needs full history to compute commit ranges. Without it, the action fails loudly with a clear error message.
- **`permissions.contents: write`** on the workflow to push to `gh-pages`
- **`permissions.pull-requests: write`** if you want PR preview comments (optional — the deploy itself succeeds without this permission, you just won't get the sticky comment)

---

## Navigation widget

Every deployed HTML page gets a small floating button in the bottom-right corner. Clicking it opens a panel listing all deployed versions, with a "← Index" link back to the root index page.

The widget is injected as a single `<script>` tag before `</body>`, wraps everything in a Shadow DOM (`mode: 'open'`, `:host { all: initial }`), and fetches `../versions.json` lazily on first open. **It cannot be broken by host-page CSS** — not even aggressive resets with `color: red !important` on everything.

To opt out: don't use this tool. There's no configuration knob to disable injection in v1 — the widget is the point.

---

## Concurrent runs

Use GitHub's `concurrency` groups to serialize deploys:

```yaml
concurrency:
  group: pages-deploy
  cancel-in-progress: false
```

If two runs slip through anyway (or you use the CLI from multiple machines), the tool handles it via **fetch-rebase-push retry**: on a non-fast-forward push, it fetches the latest `gh-pages`, re-applies the worktree changes, and retries. No corruption, no lost versions.

---

## Troubleshooting

**"Previous SHA not reachable (shallow clone)"** — your `actions/checkout` step needs `fetch-depth: 0`. Git metadata extraction requires full history.

**PR comment doesn't appear** — check that the workflow has `permissions.pull-requests: write`. If the action logs `403 from GitHub API`, the permission is missing. The deploy itself still succeeds — the comment is optional.

**Deployed site 404s on CSS/JS** — try `base-path-mode: rewrite` instead of the default `base-tag`. Some hosts (or sites that set their own `<base href>`) need direct URL rewriting.

**Widget doesn't load version list** — check the browser's network tab; the widget fetches `../versions.json` relative to the current page. If you moved the manifest (don't — the tool writes it at the gh-pages root), update your workflow.

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
prepareBranch           (fetch gh-pages, create worktree)
    ↓
placeContent            (rsync source-dir → workdir/versionSlot/)
    ↓
injectWidget            (walk *.html, insert script tag before </body>)
    ↓
renderIndexHtml         (regenerate root index.html from manifest)
    ↓
writeManifest           (update versions.json atomically)
    ↓
commitAndPush           (one atomic commit, fetch-rebase on non-ff)
    ↓
upsertPreviewComment    (only in PR context, Action only)
```

No conditional stages. No `if PR ...` branches. Stages that aren't relevant are no-ops on empty data.

---

## Development

```bash
git clone https://github.com/brandon-fryslie/gh-pages-multiplexer
cd gh-pages-multiplexer
npm install
npm test              # 165 tests across unit + E2E pipeline fixtures
npm run build         # produces dist/index.js (Action) and dist/cli.js (CLI)
```

Tests use real git fixtures and real filesystem operations — no mocks of git or fs. Build is a Rollup bundle; the `dist/` directory is checked in so the Action can be consumed via `uses: owner/repo@v1` without a build step on the consumer side.

---

## License

MIT
