// [LAW:effects-at-boundaries] The one place a child process is spawned for git (see branch-manager).
import { spawn } from 'node:child_process';

export interface SubprocessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SubprocessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Run `command` to completion and collect its output. stdin is the null device, so the child reads
 * EOF at once: there is no pipe for it to close before a write (EPIPE) or to wait on forever (a hang).
 * A non-zero exit is an answer the caller interprets; failing to spawn, or a death by signal, rejects.
 */
export function runSubprocess(command: string, args: string[], options: SubprocessOptions): Promise<SubprocessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === null) {
        reject(new Error(`${command} ${args.join(' ')} was killed by ${signal}`));
        return;
      }
      resolve({ exitCode: code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
