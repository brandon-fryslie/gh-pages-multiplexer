// [LAW:single-enforcer] This module is the sole place that calls the GitHub
//   Releases API. The deploy pipeline never calls it directly; it only consumes
//   the ReleaseInfo value the adapter produced.
// [LAW:one-way-deps] Depends only on types.ts. No pipeline stage depends on this module.
// [LAW:dataflow-not-control-flow] Always returns a value (ReleaseInfo | null).
//   404 → null; other errors → warning + null (non-fatal — release metadata is optional).
import * as core from '@actions/core';
import type { ReleaseInfo } from './types.js';

export interface ReleaseOctokit {
  rest: {
    repos: {
      getReleaseByTag(params: {
        owner: string;
        repo: string;
        tag: string;
      }): Promise<{
        data: {
          name?: string | null;
          body?: string | null;
          html_url: string;
          published_at?: string | null;
          prerelease: boolean;
          tag_name: string;
        };
      }>;
    };
  };
}

/**
 * Extract the tag name from a refs/tags/<name> ref. Returns null for non-tag refs.
 */
export function tagNameFromRef(ref: string): string | null {
  const m = /^refs\/tags\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

/**
 * Fetch release metadata for a tag ref. Returns null when:
 *   - the ref is not a tag ref
 *   - no release exists for the tag (404)
 *   - any other API error (warning logged; non-fatal)
 */
export async function fetchReleaseForRef(
  octokit: ReleaseOctokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<ReleaseInfo | null> {
  const tag = tagNameFromRef(ref);
  if (!tag) return null;

  let res;
  try {
    res = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`Release lookup for tag ${tag} failed: ${msg}. Proceeding without release metadata.`);
    return null;
  }

  const data = res.data;
  return {
    name: data.name && data.name.length > 0 ? data.name : data.tag_name,
    body: data.body ?? '',
    url: data.html_url,
    published_at: data.published_at ?? '',
    prerelease: data.prerelease,
  };
}
