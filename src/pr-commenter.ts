// [LAW:one-source-of-truth] PREVIEW_COMMENT_MARKER is the sole identity check for "this is the
//   gh-pages-multiplexer preview comment." Same pattern as the widget marker (Phase 4 D-12).
// [LAW:dataflow-not-control-flow] Every call runs the same three-step pipeline: list → select →
//   write. The variability lives in the data: the matched comment id drives whether the write
//   call is updateComment or createComment. Exactly one write happens on every successful run.
// [LAW:single-enforcer] This module is the only place that knows the marker, the body template,
//   and the 403-swallow boundary. Callers (src/index.ts) only call upsertPreviewComment.
// [LAW:no-defensive-null-guards] exception: D-19 — the only swallowed error is HTTP 403, because
//   the comment is genuinely optional and the deploy has already succeeded by the time this runs.
//   Every other error rethrows. The exception is bounded to one discriminator (err.status === 403).
import * as core from '@actions/core';

export const PREVIEW_COMMENT_MARKER = '<!-- gh-pages-multiplexer:preview -->';

export interface PreviewCommentOpts {
  owner: string;
  repo: string;
  prNumber: number;
  previewUrl: string;
  version: string;
}

export interface CommenterOctokit {
  rest: {
    issues: {
      listComments(params: { owner: string; repo: string; issue_number: number; per_page?: number }): Promise<{ data: Array<{ id: number; body?: string | null }> }>;
      createComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
      updateComment(params: { owner: string; repo: string; comment_id: number; body: string }): Promise<unknown>;
    };
  };
}

function buildBody(opts: PreviewCommentOpts): string {
  const ts = new Date().toISOString();
  return [
    PREVIEW_COMMENT_MARKER,
    '### 📦 Preview deployed',
    '',
    `**Version:** \`${opts.version}\``,
    `**Preview:** ${opts.previewUrl}`,
    '',
    `_Updated at ${ts}_`,
  ].join('\n');
}

function is403(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 403;
}

function warnPermissions(action: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  core.warning(
    `PR preview comment ${action} returned 403: ${msg}. ` +
    `Add \`permissions: pull-requests: write\` to your workflow to enable preview comments. ` +
    `(Deploy succeeded; comment is optional — see D-19.)`,
  );
}

export async function upsertPreviewComment(
  octokit: CommenterOctokit,
  opts: PreviewCommentOpts,
): Promise<void> {
  // Step 1: list. 403 = missing pull-requests: read; swallow with warning per D-14/D-19.
  let comments: Array<{ id: number; body?: string | null }>;
  try {
    const res = await octokit.rest.issues.listComments({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.prNumber,
      per_page: 100,
    });
    comments = res.data;
  } catch (err) {
    if (is403(err)) {
      warnPermissions('list', err);
      return;
    }
    throw err;
  }

  // Step 2: select by marker (data-driven; first match wins, deterministic).
  const matched = comments.find((c) => (c.body ?? '').includes(PREVIEW_COMMENT_MARKER));

  // Step 3: write. Which write is data-driven.
  const body = buildBody(opts);
  try {
    if (matched) {
      await octokit.rest.issues.updateComment({
        owner: opts.owner,
        repo: opts.repo,
        comment_id: matched.id,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        owner: opts.owner,
        repo: opts.repo,
        issue_number: opts.prNumber,
        body,
      });
    }
  } catch (err) {
    if (is403(err)) {
      warnPermissions(matched ? 'update' : 'create', err);
      return;
    }
    throw err;
  }
}
