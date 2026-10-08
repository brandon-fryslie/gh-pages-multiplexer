import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSubprocess } from '../src/subprocess.js';

describe('runSubprocess', () => {
  it('gives the child an empty stdin, so a command that reads it finishes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'subprocess-'));
    try {
      await runSubprocess('git', ['init', '--quiet'], { cwd: dir, env: process.env });
      // mktree builds its tree from stdin: an open pipe would hang it, EOF yields the empty tree.
      expect(await runSubprocess('git', ['mktree'], { cwd: dir, env: process.env })).toEqual({
        exitCode: 0,
        stdout: '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n',
        stderr: '',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a non-zero exit with its stderr instead of rejecting', async () => {
    const out = await runSubprocess('git', ['no-such-command'], { cwd: tmpdir(), env: process.env });
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toMatch(/no-such-command/);
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(runSubprocess('no-such-binary-gh-pages', [], { cwd: tmpdir(), env: process.env })).rejects.toThrow(/ENOENT/);
  });
});
