import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as core from '@actions/core';
import {
  upsertPreviewComment,
  PREVIEW_COMMENT_MARKER,
  type CommenterOctokit,
} from '../src/pr-commenter.js';

interface MockOpts {
  existingComments?: Array<{ id: number; body?: string | null }>;
  listError?: Error & { status?: number };
  createError?: Error & { status?: number };
  updateError?: Error & { status?: number };
}

function makeMockOctokit(options: MockOpts) {
  const calls = { list: 0, create: 0, update: 0 };
  const last = { createBody: undefined as string | undefined, updateCommentId: undefined as number | undefined, updateBody: undefined as string | undefined };
  const octokit: CommenterOctokit = {
    rest: {
      issues: {
        async listComments(_params) {
          calls.list++;
          if (options.listError) throw options.listError;
          return { data: options.existingComments ?? [] };
        },
        async createComment(params) {
          calls.create++;
          last.createBody = params.body;
          if (options.createError) throw options.createError;
          return {};
        },
        async updateComment(params) {
          calls.update++;
          last.updateCommentId = params.comment_id;
          last.updateBody = params.body;
          if (options.updateError) throw options.updateError;
          return {};
        },
      },
    },
  };
  return { octokit, calls, last };
}

const OPTS = {
  owner: 'o',
  repo: 'r',
  prNumber: 42,
  previewUrl: 'https://o.github.io/r/v1/',
  version: 'v1',
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(core, 'warning').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upsertPreviewComment', () => {
  it('creates a new comment when no marker found', async () => {
    const { octokit, calls, last } = makeMockOctokit({
      existingComments: [
        { id: 1, body: 'random unrelated comment' },
        { id: 2, body: '+1' },
      ],
    });
    await upsertPreviewComment(octokit, OPTS);
    expect(calls.list).toBe(1);
    expect(calls.create).toBe(1);
    expect(calls.update).toBe(0);
    const body = last.createBody!;
    expect(body.startsWith(PREVIEW_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('### 📦 Preview deployed');
    expect(body).toContain('**Version:** `v1`');
    expect(body).toContain('**Preview:** https://o.github.io/r/v1/');
    expect(body).toMatch(/_Updated at .*_/);
  });

  it('updates when a marker-bearing comment is found', async () => {
    const { octokit, calls, last } = makeMockOctokit({
      existingComments: [
        { id: 7, body: `old preview ${PREVIEW_COMMENT_MARKER}\n\n### 📦 Preview deployed\n**Version:** \`v0\`\n**Preview:** https://x` },
      ],
    });
    await upsertPreviewComment(octokit, OPTS);
    expect(calls.list).toBe(1);
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(1);
    expect(last.updateCommentId).toBe(7);
    expect(last.updateBody).toContain('**Version:** `v1`');
    expect(last.updateBody).toContain(OPTS.previewUrl);
  });

  it('first marker wins when multiple markers exist', async () => {
    const { octokit, calls, last } = makeMockOctokit({
      existingComments: [
        { id: 1, body: `${PREVIEW_COMMENT_MARKER}\nold1` },
        { id: 9, body: `${PREVIEW_COMMENT_MARKER}\nold2` },
      ],
    });
    await upsertPreviewComment(octokit, OPTS);
    expect(calls.update).toBe(1);
    expect(calls.create).toBe(0);
    expect(last.updateCommentId).toBe(1);
  });

  it('swallows 403 on listComments with a permissions warning', async () => {
    const err = Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
    const { octokit, calls } = makeMockOctokit({ listError: err });
    await expect(upsertPreviewComment(octokit, OPTS)).resolves.toBeUndefined();
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    const msg = (warnSpy.mock.calls[0][0] as string);
    expect(msg).toContain('permissions');
    expect(msg).toContain('pull-requests: write');
  });

  it('swallows 403 on createComment with a warning', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const { octokit, calls } = makeMockOctokit({ existingComments: [], createError: err });
    await expect(upsertPreviewComment(octokit, OPTS)).resolves.toBeUndefined();
    expect(calls.create).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    const msg = (warnSpy.mock.calls[0][0] as string);
    expect(msg).toContain('pull-requests: write');
  });

  it('swallows 403 on updateComment with a warning', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const { octokit, calls } = makeMockOctokit({
      existingComments: [{ id: 3, body: PREVIEW_COMMENT_MARKER }],
      updateError: err,
    });
    await expect(upsertPreviewComment(octokit, OPTS)).resolves.toBeUndefined();
    expect(calls.update).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rethrows non-403 list error (500)', async () => {
    const err = Object.assign(new Error('boom'), { status: 500 });
    const { octokit } = makeMockOctokit({ listError: err });
    await expect(upsertPreviewComment(octokit, OPTS)).rejects.toThrow('boom');
  });

  it('rethrows 404 on PR', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    const { octokit } = makeMockOctokit({ listError: err });
    await expect(upsertPreviewComment(octokit, OPTS)).rejects.toThrow('not found');
  });

  it('rethrows network error with no status', async () => {
    const { octokit } = makeMockOctokit({ listError: new Error('ECONNRESET') });
    await expect(upsertPreviewComment(octokit, OPTS)).rejects.toThrow('ECONNRESET');
  });

  it('exports the expected marker constant', () => {
    expect(PREVIEW_COMMENT_MARKER).toBe('<!-- gh-pages-multiplexer:preview -->');
  });

  it('two calls produce identical bodies except for the timestamp', async () => {
    const { octokit: o1, last: l1 } = makeMockOctokit({ existingComments: [] });
    const { octokit: o2, last: l2 } = makeMockOctokit({ existingComments: [] });
    await upsertPreviewComment(o1, OPTS);
    await new Promise((r) => setTimeout(r, 2));
    await upsertPreviewComment(o2, OPTS);
    const strip = (s: string) => s.replace(/_Updated at .*?_/, '_Updated at T_');
    expect(strip(l1.createBody!)).toBe(strip(l2.createBody!));
  });

  it('version with backticks still appears in body without breaking frame', async () => {
    const { octokit, last } = makeMockOctokit({ existingComments: [] });
    await upsertPreviewComment(octokit, { ...OPTS, version: 'weird`v' });
    const body = last.createBody!;
    expect(body).toContain('**Version:**');
    expect(body).toContain('weird');
    expect((body.match(new RegExp(PREVIEW_COMMENT_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) ?? []).length).toBe(1);
  });
});
