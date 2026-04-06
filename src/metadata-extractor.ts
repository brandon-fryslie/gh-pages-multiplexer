// [LAW:single-enforcer] This module is the sole place that shells out to `git log`.
// [LAW:one-source-of-truth] META-03: the manifest is the home for commit data;
// this module is the single producer of CommitInfo[] records.
// [LAW:dataflow-not-control-flow] Same operations every invocation -- the range
// argument is the only datum that varies. The force-push fallback is a value-driven
// retry with a different revRange, not a branch that skips work.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import type { CommitInfo } from './types.js';

const exec = promisify(execFile);

const MAX_COMMITS = 100;
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT = `%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%B${RECORD_SEP}`;

const UNREACHABLE_TAG = 'GHPM_UNREACHABLE_REV';

async function isShallowRepo(repoDir: string): Promise<boolean> {
  try {
    await access(path.join(repoDir, '.git', 'shallow'));
    return true;
  } catch {
    return false;
  }
}

async function runGitLog(repoDir: string, revRange: string): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      ['log', `--format=${FORMAT}`, '-n', String(MAX_COMMITS), revRange],
      { cwd: repoDir, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const stderr = (e.stderr ?? '') + (e.message ?? '');
    if (/unknown revision|bad revision|ambiguous argument|invalid revision range/i.test(stderr)) {
      throw new Error(`${UNREACHABLE_TAG}: ${stderr.trim()}`);
    }
    throw new Error(
      `git log failed in ${repoDir}: ${stderr.trim()}. ` +
        `If this is a shallow clone, set fetch-depth: 0 on actions/checkout.`,
    );
  }
}

function parseLog(stdout: string): CommitInfo[] {
  // [LAW:dataflow-not-control-flow] Split -> filter empty -> map. No branches over count.
  const records = stdout
    .split(RECORD_SEP)
    .map((r) => (r.startsWith('\n') ? r.slice(1) : r))
    .filter((r) => r.includes(FIELD_SEP));
  return records.map((record) => {
    const parts = record.split(FIELD_SEP);
    const [sha, author_name, author_email, timestamp, ...messageParts] = parts;
    return {
      sha,
      author_name,
      author_email,
      timestamp,
      // Rejoin in case the message somehow contained FIELD_SEP; preserve newlines.
      message: messageParts.join(FIELD_SEP),
    };
  });
}

/**
 * Extract commit history for a deployment.
 *
 * @param repoDir    Source repo directory (already checked out).
 * @param currentSha Deployment head SHA.
 * @param previousSha Prior manifest entry SHA, or null for first deploy.
 * @returns Up to MAX_COMMITS CommitInfo records, newest first.
 */
export async function extractCommits(
  repoDir: string,
  currentSha: string,
  previousSha: string | null,
): Promise<CommitInfo[]> {
  const firstDeployRange = currentSha;
  const incrementalRange =
    previousSha === null ? firstDeployRange : `${previousSha}..${currentSha}`;

  // A .git/shallow file means history is truncated -- an unreachable previousSha
  // may be due to that truncation rather than a force-push. In that case we must
  // fail loudly per D-11 so the user sets fetch-depth: 0.
  const shallow = await isShallowRepo(repoDir);

  let stdout: string;
  try {
    stdout = await runGitLog(repoDir, incrementalRange);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith(UNREACHABLE_TAG)) {
      if (shallow) {
        throw new Error(
          `git log failed in ${repoDir}: previous SHA ${previousSha ?? 'null'} ` +
            `is not reachable in this shallow clone. Set fetch-depth: 0 on actions/checkout.`,
        );
      }
      core.info(
        `Previous SHA ${previousSha ?? 'null'} not reachable (force-push?); ` +
          `falling back to full history capped at ${MAX_COMMITS}.`,
      );
      stdout = await runGitLog(repoDir, firstDeployRange);
    } else {
      throw err;
    }
  }

  const commits = parseLog(stdout).slice(0, MAX_COMMITS);
  if (commits.length === MAX_COMMITS) {
    core.info(`Commit history capped at ${MAX_COMMITS} for this deployment.`);
  }
  return commits;
}
