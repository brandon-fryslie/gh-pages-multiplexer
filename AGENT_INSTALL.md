# Agent Install Prompt — gh-pages-multiplexer

> **For humans:** Open this file, copy everything from the `--- BEGIN PROMPT ---` line to the `--- END PROMPT ---` line, and paste it to a coding agent (Claude Code, Cursor, Aider, Copilot, etc.) running inside your repository. Or just tell the agent: *"Follow the instructions at https://github.com/brandon-fryslie/gh-pages-multiplexer/blob/v1/AGENT_INSTALL.md"*.
>
> The agent will read your repo, detect existing conventions, and wire up the action correctly.

---

## --- BEGIN PROMPT ---

You are installing the GitHub Action **`brandon-fryslie/gh-pages-multiplexer`** into the current repository. This action deploys static sites into versioned subdirectories on a `gh-pages` branch, generates an index page, injects a navigation widget, and posts PR preview comments.

Follow these steps **in order**. Do not skip investigation steps. Do not invent details — inspect the repo and ask the user only when information is genuinely unavailable from the filesystem.

## 0. Read the action's contract

Before touching anything, fetch and read the authoritative inputs/outputs so you don't guess:

- https://raw.githubusercontent.com/brandon-fryslie/gh-pages-multiplexer/v1/action.yml
- https://raw.githubusercontent.com/brandon-fryslie/gh-pages-multiplexer/v1/README.md

Key facts from the action:

- **Required input:** `source-dir` (directory containing the built static site)
- **Optional inputs:** `target-branch` (default `gh-pages`), `ref-patterns` (default `*`), `base-path-mode` (`base-tag` | `rewrite` | `none`, default `base-tag`), `base-path-prefix`, `version`, `token`
- **Outputs:** `version`, `url`
- **Runtime:** `node24` — the consumer workflow does not need to set up Node; the Action brings its own
- **Prerequisite:** `actions/checkout@v4` with `fetch-depth: 0` (git metadata extraction needs full history)
- **Required workflow permission:** `contents: write` (to push to gh-pages)
- **Optional workflow permission:** `pull-requests: write` (only if the user wants PR preview sticky comments)

## 1. Investigate the repo

Run these checks (use the file tools available to you — do not shell out unnecessarily):

1. **Does `.github/workflows/` exist?** List its contents.
2. **Is there a build step?** Look for:
   - `package.json` → `"scripts": { "build": ... }` → this is almost certainly the build command
   - `Gemfile` / `_config.yml` → Jekyll site
   - `mkdocs.yml` → MkDocs
   - `hugo.toml` / `config.toml` → Hugo
   - `astro.config.*`, `next.config.*`, `vite.config.*`, `svelte.config.*`, `nuxt.config.*` → SSG framework
   - No build at all → static HTML in repo root or a `docs/` / `public/` / `site/` folder
3. **What is the output directory?** Infer from the framework:
   - Next.js static export: `out`
   - Vite / Astro / SvelteKit (static): `dist`
   - Nuxt (generate): `.output/public` or `dist`
   - Hugo: `public`
   - Jekyll: `_site`
   - MkDocs: `site`
   - Raw static: the directory that contains `index.html`
4. **Is `gh-pages` already in use?** Check `git branch -r` (or `git ls-remote --heads origin gh-pages` via the terminal) to see if the branch exists. If it does, note it — the user may already have deployments you must preserve. This action **preserves** existing version subdirectories by design, but warn the user if their current `gh-pages` has a root `index.html` that will be replaced with the auto-generated one.
5. **What is the repo's default branch?** Read `.git/HEAD` or `git symbolic-ref refs/remotes/origin/HEAD`. It's usually `main` but don't assume.
6. **Does the user want PR previews?** Ask once, briefly. Default to yes if they don't care.
7. **Does the repo have a `CNAME` file anywhere (custom domain)?** If so, note it — the action does not currently rewrite custom-domain CNAMEs; preview URLs will show the `github.io` URL. Tell the user.
8. **Does the build tool support a build-time base URL?** This is important — it unlocks the most reliable path. Check the config files:
   - **Vite** (`vite.config.*`): supports `base: '/path/'`, either hard-coded or via `import.meta.env.BASE_URL` / `process.env.VITE_BASE`
   - **Next.js** (`next.config.*`): supports `basePath: '/path'` and `assetPrefix`
   - **Astro** (`astro.config.*`): supports `base: '/path/'`, often via `import.meta.env.BASE_URL` or `process.env.BASE`
   - **SvelteKit** (`svelte.config.*`): supports `kit.paths.base: '/path'`
   - **Nuxt** (`nuxt.config.*`): supports `app.baseURL: '/path/'`
   - **VitePress / VuePress / Docusaurus**: each has a `base` option in their config
   - **create-react-app / react-scripts**: supports `PUBLIC_URL` env var at build time
   - **Hugo**: `--baseURL=` flag or `baseURL` in config
   - **Jekyll**: `baseurl` in `_config.yml` (but typically set statically — harder to parameterize per deploy)
   - **mkdocs**: `site_url` in `mkdocs.yml`
   - **Raw HTML with no build** — no build-time base URL is possible; fall back to `base-path-mode: base-tag` or `rewrite`.

   If the build tool supports a build-time base URL **and** the config already reads it from an environment variable (or can be easily refactored to), you can use the **preferred path** in step 4 below: pass an explicit `version` to the action AND set `base-path-mode: none`, after rebuilding the site with the matching base URL. This is more reliable than post-hoc HTML rewriting because the build tool knows about every asset reference (framework image helpers, dynamic imports, CSS `url(...)`, etc.) that a regex-based rewrite might miss.

## 2. Decide the integration mode

Based on step 1, pick **exactly one**:

### Mode A — No existing workflows

`.github/workflows/` doesn't exist or contains no deploy/publish workflow. Create a new workflow file.

### Mode B — Existing workflow handles the build

There's a workflow that already builds the site (e.g., runs tests + `npm run build`) but doesn't deploy. **Add a new deploy job** to that same workflow file, downstream of the build job via `needs:`. Upload the build output as an artifact in the build job and download it in the deploy job.

### Mode C — Existing workflow already deploys to gh-pages

There's a workflow using `actions/deploy-pages`, `peaceiris/actions-gh-pages`, `JamesIves/github-pages-deploy-action`, or similar. **Replace** the existing deploy step with `gh-pages-multiplexer` — but before replacing, confirm with the user because this changes the semantics from single-deployment to multi-version. If they confirm, preserve any custom behavior (source dir, ref filtering, branch name) in the new step's inputs.

### Mode D — Monorepo with multiple deployable subprojects

Each subproject would need its own version slot. Ask the user which subproject(s) to deploy. Install per-subproject — do not try to deploy the whole monorepo as one version.

## 3. Match existing conventions

**This is mandatory when integrating into an existing workflow.** Before writing any YAML:

1. **Indentation:** match what's already used (2-space is almost universal; some repos use 4)
2. **Quoting style:** note whether existing workflows use `'single'` or `"double"` or unquoted strings for values — match it
3. **Runner:** use the same runner the existing workflows use (`ubuntu-latest`, `ubuntu-22.04`, etc.) unless there's a specific reason not to
4. **Action version pinning:** match the existing style — if they pin by SHA, pin `gh-pages-multiplexer` by SHA; if they pin by major tag (`@v1`), use `@v1`; if they use `@main`, use `@main` (and warn the user this is not recommended)
5. **Trigger naming:** if existing workflows use `on: { push: { branches: [main] } }`, use the same pattern — don't switch to `on: push: branches: [main]` shorthand mid-file
6. **Job naming:** match the casing convention (`deploy`, `Deploy`, `deploy-pages`, etc.)
7. **Concurrency groups:** if the existing workflow already has a `concurrency:` block, make sure your deploy job's concurrency group is compatible or add one that serializes deploys (`group: pages-deploy`, `cancel-in-progress: false`)
8. **Environment variables:** if the repo uses `env:` at workflow or job level, honor it — don't duplicate env vars at step level
9. **Secrets usage:** if the repo references secrets via `${{ secrets.X }}` with specific naming conventions, follow them. The default `${{ github.token }}` is almost always enough; don't ask for a PAT unless the user explicitly needs cross-repo deploys.

If you cannot determine a convention with confidence, read 2–3 existing workflow files before writing yours.

## 4. Write the workflow

Pick the right path based on what you found in §1 step 8:

- **Path A — Build-time base URL (preferred when possible).** The build tool supports setting an absolute base URL at build time (Vite, Next.js, Astro, SvelteKit, etc.). Use this when available — it's more reliable than post-hoc rewriting because the build tool knows about every asset reference.
- **Path B — Post-hoc rewriting (fallback).** The build doesn't support a base URL, or the site is static HTML with no build. The action injects `<base href>` or rewrites URLs after the fact.

### Path A (preferred) — explicit version + `base-path-mode: none`

```yaml
name: Deploy
on:
  push:
    branches: [main]        # or whatever the default branch is
    tags: ['v*']
  pull_request:             # omit if user declined PR previews

concurrency:
  group: pages-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write  # omit if user declined PR previews
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compute version slot
        id: version
        run: |
          # For tag pushes → use the tag. For branches → use branch name. For PRs → pr-N.
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "slot=pr-${{ github.event.pull_request.number }}" >> "$GITHUB_OUTPUT"
          elif [ "${{ github.ref_type }}" = "tag" ]; then
            echo "slot=${{ github.ref_name }}" >> "$GITHUB_OUTPUT"
          else
            echo "slot=${{ github.ref_name }}" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Build with explicit base URL
        env:
          # Pick ONE of these based on the detected build tool:
          VITE_BASE: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}/
          # NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}
          # ASTRO_BASE: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}/
          # PUBLIC_URL: /${{ github.event.repository.name }}/${{ steps.version.outputs.slot }}
        run: npm run build

      - uses: brandon-fryslie/gh-pages-multiplexer@v1
        with:
          source-dir: dist                               # adapt to framework output dir
          version: ${{ steps.version.outputs.slot }}     # must match the base URL you built with
          base-path-mode: none                           # the build already set URLs correctly
```

**Critical:** the `version:` input and the base URL you pass to the build tool **must match exactly**. If they drift, assets will 404. The single source of truth is `steps.version.outputs.slot` — reference it in both places, never hand-copy.

Make sure the repo's build tool config actually reads from the environment variable you set. Examples:

- **Vite:** `export default { base: process.env.VITE_BASE || '/' }`
- **Next.js:** `module.exports = { basePath: process.env.NEXT_PUBLIC_BASE_PATH || '' }`
- **Astro:** `export default { base: process.env.ASTRO_BASE || '/' }`
- **SvelteKit:** `kit: { paths: { base: process.env.SVELTE_BASE || '' } }`

If the config hard-codes a different value, you'll need to refactor it to read from the env var. Ask the user before modifying build config.

### Path B (fallback) — post-hoc rewriting

Use this when there's no build-time base URL, the site is raw HTML, or the build tool can't be easily configured to read from env vars.

```yaml
name: Deploy
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

concurrency:
  group: pages-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # === BUILD STEP — customize per framework, or omit if site is pre-built ===
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      # =========================================================================

      - uses: brandon-fryslie/gh-pages-multiplexer@v1
        with:
          source-dir: dist
          base-path-mode: rewrite   # 'rewrite' is safer for SPAs; 'base-tag' for simple sites
```

### Critical rules for both paths

- `fetch-depth: 0` is **non-negotiable**. Without it, git metadata extraction fails loudly. Do not omit it to "speed up checkout."
- Do **not** add `actions/setup-node` before the `gh-pages-multiplexer` step to set up Node **for the action** — the Action bundles its own Node 24 runtime. `setup-node` is only for your **build** step.
- If the user's site is pre-built and committed (no build step), skip the build section entirely and point `source-dir` at the existing folder (`docs`, `site`, `public`, whatever). In that case Path A doesn't apply — use Path B with `base-path-mode: base-tag` (default) or `rewrite`.
- If the user only wants certain refs deployed (e.g. "only tags"), set `ref-patterns: 'v*'` or `'refs/tags/v*'`. Note: `ref-patterns` is **ignored** when `version:` is set in Path A — the explicit version is interpreted as "deploy this no matter what."
- Path A (`base-path-mode: none`) + no `version:` is a **configuration error** — the default version is derived from the ref, but in Path A you explicitly want it to match the base URL you built with. Always set both, or neither.

## 5. Enable GitHub Pages in repo settings

After the workflow lands, the user must enable Pages:

1. Go to **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose branch `gh-pages` and folder `/ (root)`
4. Save

If the repo already has Pages configured for a **different** branch (e.g. `main`), warn the user that switching to `gh-pages` will break their current setup until the first deploy completes.

Offer to do this automatically via the GitHub CLI if available:

```bash
gh api -X POST repos/{owner}/{repo}/pages \
  -f 'source[branch]=gh-pages' \
  -f 'source[path]=/' \
  2>/dev/null || \
gh api -X PUT  repos/{owner}/{repo}/pages \
  -f 'source[branch]=gh-pages' \
  -f 'source[path]=/'
```

(POST creates, PUT updates — try POST first, fall back to PUT.)

## 6. Verify

1. Commit the workflow file with a clear message: `ci: add gh-pages-multiplexer for versioned deploys`
2. Push to the default branch. Watch the workflow run:
   ```bash
   gh run watch
   ```
3. On success, check:
   - `git fetch origin gh-pages && git ls-tree --name-only origin/gh-pages` should show the new version subdirectory + `index.html` + `versions.json`
   - `curl https://{owner}.github.io/{repo}/` should serve the index page
   - `curl https://{owner}.github.io/{repo}/{version}/` should serve the deployed site

4. If the deploy fails, read the logs via `gh run view --log-failed` and diagnose. Common failures:
   - **"Previous SHA not reachable (shallow clone)"** → you forgot `fetch-depth: 0`
   - **403 on push to gh-pages** → missing `permissions: contents: write`
   - **403 on PR comment** → missing `permissions: pull-requests: write` (deploy still succeeded; the comment is optional — inform the user and offer to add the permission)
   - **"ref pattern did not match"** → your `ref-patterns:` filter excluded the current ref

## 7. Report to the user

Tell the user exactly what you did, in this format:

```
Installed gh-pages-multiplexer:
  Workflow: .github/workflows/<name>.yml (created | modified)
  Build command detected: <command>
  Output directory: <dir>
  PR previews: enabled | disabled
  Base-path mode: base-tag | rewrite
  Pages source: gh-pages (enabled | needs manual enable in repo settings)

First deploy will run on: <trigger — push to main | next tag | etc.>
Deployed URL will be: https://<owner>.github.io/<repo>/<version>/
Index page will be at: https://<owner>.github.io/<repo>/
```

## Rules for this installation

- **Do not** add the action without first detecting the build system and output directory.
- **Do not** overwrite existing workflows without explicit user confirmation.
- **Do not** skip the `fetch-depth: 0` requirement.
- **Do not** add `node-version:` to the `gh-pages-multiplexer` step — the action manages its own runtime.
- **Do not** use `|| true`, `2>/dev/null` error swallowing, or silent fallbacks in the workflow. If something fails, let it fail loudly.
- **Do** match existing conventions when integrating into an established workflow.
- **Do** ask the user exactly one question if you need to: "Do you want PR preview deployments?" — everything else should be inferable from the repo.
- **Do** report what you did clearly when finished.

## --- END PROMPT ---
