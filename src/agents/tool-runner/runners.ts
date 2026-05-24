import { spawn } from 'node:child_process';

import {
  ScannerExecutionError,
  ScannerNotInstalledError,
} from '../../types/errors.js';

interface SubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * Production-default subprocess runner used by the tool-runner agent.
 *
 * Structurally compatible with `GitleaksRunner`, `OsvRunner`, and
 * `SemgrepRunner` because all three types share the shape
 * `(binary, args, opts) => Promise<{stdout, stderr, exitCode}>`. Tests
 * inject fake runners directly into `ToolRunnerInput.runners`, so this
 * code path is not exercised by the unit-test suite.
 *
 * Constraints (per `CLAUDE.md §Hard rules`):
 *
 *  - `spawn` with array args (never `exec`, never a shell string)
 *  - explicit timeout
 *  - ENOENT → typed `ScannerNotInstalledError`, never a generic crash
 */
export function createDefaultSubprocessRunner(): (
  binary: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<SubprocessResult> {
  return (binary, args, opts) =>
    new Promise<SubprocessResult>((resolve, reject) => {
      const child = spawn(binary, [...args], { timeout: opts.timeoutMs });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (e) => {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(new ScannerNotInstalledError(binary));
          return;
        }
        reject(new ScannerExecutionError(binary, e.message, { cause: e }));
      });
      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
}
