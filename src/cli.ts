// [LAW:one-type-per-behavior] CLI is a second adapter into the same deploy() pipeline used by the
//   Action adapter. It contains NO pipeline logic — only argv/env → DeployConfig translation, exit
//   code mapping, and stderr formatting.
// [LAW:variability-at-edges] The pipeline core is fixed in src/deploy.ts. CI-specific input
//   gathering (argv vs @actions/core, env vars vs core.getInput) lives at the edge here.
// [LAW:dataflow-not-control-flow] main() always runs the same sequence: parse argv → resolve
//   token → build config → call deploy → map result to exit code. Errors are data on the result
//   path (exit codes), not scattered short-circuits.
import { parseArgs } from 'node:util';
import type { DeployConfig } from './types.js';
import { deploy } from './deploy.js';
import { parseWidgetPosition, validateWidgetColor } from './widget-config.js';

const VERSION = '0.0.0'; // Synced with package.json version; bump together.

const HELP_TEXT = `Usage: gh-pages-multiplexer deploy [options]

Deploy a static site to a versioned subdirectory on a GitHub Pages branch.

Options:
  --source-dir=<path>          Directory containing the built site (required)
  --target-branch=<name>       Target gh-pages branch (default: gh-pages)
  --ref-patterns=<csv>         Comma-separated ref patterns to deploy
  --base-path-mode=<mode>      base-tag | rewrite | none (default: base-tag)
                               'none' = caller set base URL at build time; skip rewriting
  --base-path-prefix=<prefix>  Override auto-detected base path prefix
  --repo=<owner/name>          Repository slug (default: $GITHUB_REPOSITORY)
  --ref=<refs/...>             Git ref being deployed (default: $GITHUB_REF)
  --deploy-version=<name>      Explicit version slot (overrides ref-derived name)
  --widget-icon=<svg>          Custom SVG markup for widget icon (default: layers)
  --widget-label=<text>        Widget label, supports {version} token (default: "{version}")
  --widget-position=<spec>     Widget location: "<edge> <vertical%>" (default: "right 80%")
  --widget-color=<hex>         Widget handle background hex color (default: "#f97316")
  --debug                      Print full stack traces on error
  --help                       Show this help and exit
  --version                    Print version and exit

Environment:
  GITHUB_TOKEN                 GitHub token with contents: write (preferred)
  GH_TOKEN                     Fallback token env var (matches gh CLI convention)
  DEBUG=1                      Equivalent to --debug

Exit codes:
  0  success
  1  deployment failure
  2  configuration error (missing inputs, bad flags, missing token)
`;

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`gh-pages-multiplexer ${VERSION}\n`);
    return 0;
  }

  // Only `deploy` subcommand is supported in v1 (D-01).
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'deploy') {
    process.stderr.write(
      `Error: unknown or missing subcommand '${subcommand ?? ''}'. Only 'deploy' is supported.\n` +
      `Run with --help for usage.\n`,
    );
    return 2;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: {
        'source-dir': { type: 'string' },
        'target-branch': { type: 'string' },
        'ref-patterns': { type: 'string' },
        'base-path-mode': { type: 'string' },
        'base-path-prefix': { type: 'string' },
        'repo': { type: 'string' },
        'ref': { type: 'string' },
        'deploy-version': { type: 'string' },
        'widget-icon': { type: 'string' },
        'widget-label': { type: 'string' },
        'widget-position': { type: 'string' },
        'widget-color': { type: 'string' },
        'debug': { type: 'boolean' },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    if (msg.toLowerCase().includes('token')) {
      process.stderr.write(
        `Note: tokens must be provided via the GITHUB_TOKEN or GH_TOKEN environment variable, not as a flag.\n`,
      );
    }
    return 2;
  }

  const debug = Boolean(parsed.values['debug']) || env.DEBUG === '1';

  // D-05: token from env only.
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '';
  if (!token) {
    process.stderr.write(
      `Error: no GitHub token found. Set GITHUB_TOKEN (preferred) or GH_TOKEN in the environment.\n`,
    );
    return 2;
  }

  // Required-flag validation.
  if (!parsed.values['source-dir']) {
    process.stderr.write(`Error: missing required flag --source-dir\n`);
    return 2;
  }

  const basePathMode = (parsed.values['base-path-mode'] ?? 'base-tag') as string;
  if (basePathMode !== 'base-tag' && basePathMode !== 'rewrite' && basePathMode !== 'none') {
    process.stderr.write(`Error: invalid --base-path-mode '${basePathMode}'. Must be 'base-tag', 'rewrite', or 'none'.\n`);
    return 2;
  }

  const refPatternsRaw = parsed.values['ref-patterns'];
  const refPatterns = typeof refPatternsRaw === 'string' && refPatternsRaw.length > 0
    ? refPatternsRaw.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
    : [];

  // Widget customization — validate up front so the CLI fails fast.
  const widgetPosition = (parsed.values['widget-position'] ?? '') as string;
  if (widgetPosition.length > 0) {
    try {
      parseWidgetPosition(widgetPosition);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  let widgetColor: string;
  try {
    widgetColor = validateWidgetColor((parsed.values['widget-color'] ?? '') as string);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const config: DeployConfig = {
    sourceDir: parsed.values['source-dir'] as string,
    targetBranch: (parsed.values['target-branch'] ?? 'gh-pages') as string,
    refPatterns,
    basePathMode: basePathMode as 'base-tag' | 'rewrite' | 'none',
    basePathPrefix: (parsed.values['base-path-prefix'] ?? '') as string,
    token,
    repo: (parsed.values['repo'] ?? env.GITHUB_REPOSITORY ?? '') as string,
    ref: (parsed.values['ref'] ?? env.GITHUB_REF ?? '') as string,
    version: (parsed.values['deploy-version'] ?? '') as string,
    widgetIcon: (parsed.values['widget-icon'] ?? '') as string,
    widgetLabel: (parsed.values['widget-label'] ?? '') as string,
    widgetPosition,
    widgetColor,
    prBaseRef: '',  // CLI does not distinguish PR vs non-PR deploys
    cleanupVersions: [],  // CLI has no GitHub API access; cleanup is a CI concern
  };

  try {
    const result = await deploy(config, process.cwd());
    process.stdout.write(`Deployed ${result.version} to ${result.url}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    if (debug && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    return 1;
  }
}

// Top-level CJS invocation guard — does NOT run on test imports.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && (require as { main?: unknown }).main === module) {
  main(process.argv.slice(2), process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
