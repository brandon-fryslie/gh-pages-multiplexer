// [LAW:single-enforcer] This module is the sole place that knows how to determine
//   which PR versions are stale. The adapter calls it; the pipeline never does.
// [LAW:one-way-deps] This module depends on types.ts only. It does not depend on
//   the deploy pipeline or any pipeline stage module.
// [LAW:dataflow-not-control-flow] findClosedPrVersions always queries all PR entries
//   and always returns a list. Empty input → empty output. API errors skip individual
//   entries (opportunistic cleanup retries on next deploy).
import * as core from '@actions/core';
import type { Manifest } from './types.js';

const PR_VERSION_RE = /^pr-(\d+)$/;

export interface CleanupOctokit {
  rest: {
    repos: {
      getContent(params: {
        owner: string;
        repo: string;
        path: string;
        ref?: string;
      }): Promise<{ data: { content?: string; encoding?: string } | unknown }>;
    };
    pulls: {
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: { state: string } }>;
    };
  };
}

interface PrVersionEntry {
  version: string;
  prNumber: number;
}

/**
 * Extract PR version entries from a manifest. Returns entries whose version
 * slot matches the `pr-<number>` pattern with the parsed PR number.
 */
export function extractPrEntries(manifest: Manifest): PrVersionEntry[] {
  const entries: PrVersionEntry[] = [];
  for (const v of manifest.versions) {
    const match = PR_VERSION_RE.exec(v.version);
    if (match) {
      entries.push({ version: v.version, prNumber: parseInt(match[1], 10) });
    }
  }
  return entries;
}

/**
 * Fetch versions.json from the remote branch via the GitHub Contents API.
 * Returns null if the file does not exist (first deploy) or on any error.
 */
export async function fetchRemoteManifest(
  octokit: CleanupOctokit,
  owner: string,
  repo: string,
  targetBranch: string,
): Promise<Manifest | null> {
  let res;
  try {
    res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'versions.json',
      ref: targetBranch,
    });
  } catch {
    return null;
  }

  const data = res.data as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== 'base64') return null;

  try {
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as Manifest;
    if (!Array.isArray(parsed.versions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Given a list of PR version entries, query GitHub to determine which PRs
 * are closed or merged. Returns the version slots that should be removed.
 *
 * Errors on individual PR checks are logged and skipped — cleanup is
 * opportunistic and will retry on the next deploy.
 */
export async function findClosedPrVersions(
  octokit: CleanupOctokit,
  owner: string,
  repo: string,
  prEntries: PrVersionEntry[],
): Promise<string[]> {
  if (prEntries.length === 0) return [];

  const results = await Promise.allSettled(
    prEntries.map(async (entry) => {
      const res = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: entry.prNumber,
      });
      return { version: entry.version, state: res.data.state };
    }),
  );

  const closed: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      if (result.value.state !== 'open') {
        closed.push(result.value.version);
      }
    } else {
      core.warning(
        `Cleanup: failed to check PR #${prEntries[i].prNumber} status: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }. Will retry on next deploy.`,
      );
    }
  }

  return closed;
}

/**
 * Resolve which PR versions should be cleaned up. Orchestrates: fetch remote
 * manifest → extract PR entries → check their status → return closed ones.
 *
 * Returns an empty array on any top-level failure (cleanup must never block deploy).
 */
export async function resolveCleanupVersions(
  octokit: CleanupOctokit,
  owner: string,
  repo: string,
  targetBranch: string,
): Promise<string[]> {
  const manifest = await fetchRemoteManifest(octokit, owner, repo, targetBranch);
  if (!manifest) return [];

  const prEntries = extractPrEntries(manifest);
  if (prEntries.length === 0) return [];

  core.info(`Cleanup: checking ${prEntries.length} PR version(s) for closed status`);
  return findClosedPrVersions(octokit, owner, repo, prEntries);
}
