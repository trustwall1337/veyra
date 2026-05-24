/**
 * PlaceholderScanner adapter.
 *
 * Wraps the 'placeholder-binary' CLI as a read-only subprocess. Parses JSON
 * output into typed evidence. See CLAUDE.md §Secrets and PHASE_1_PLAN §7
 * Task 9.
 *
 * Tests inject a fake Runner to avoid invoking the real binary.
 */

import { spawn } from 'node:child_process';

import { ok, err, type Result } from '../../types/result.js';

export class ScannerNotInstalledError extends Error {
  override readonly name = 'ScannerNotInstalledError';
}

export class ScannerOutputParseError extends Error {
  override readonly name = 'ScannerOutputParseError';
}

export class ScannerExecutionError extends Error {
  override readonly name = 'ScannerExecutionError';
}

export type PlaceholderScannerError =
  | ScannerNotInstalledError
  | ScannerOutputParseError
  | ScannerExecutionError;

export interface PlaceholderScannerInput {
  projectPath: string;
  // TODO: scanner-specific options
}

/**
 * Single scanner finding, AFTER redaction.
 *
 * MUST NOT include raw secret values. The parse step replaces any secret-like
 * substring with 'REDACTED' before populating this object.
 */
export interface PlaceholderScannerFinding {
  ruleId: string;
  filePath: string;
  line: number;
  description: string;
}

export interface PlaceholderScannerOutput {
  scannerVersion: string;
  findings: PlaceholderScannerFinding[];
}

export interface Runner {
  (
    binary: string,
    args: readonly string[],
    opts: { timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}

const defaultRunner: Runner = (binary, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { timeout: opts.timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new ScannerNotInstalledError(
            `'${binary}' not found on PATH. Install: <add install instructions here>`,
          ),
        );
      } else {
        reject(
          new ScannerExecutionError(`'${binary}' failed: ${e.message}`, {
            cause: e,
          }),
        );
      }
    });
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });

export async function runPlaceholderScanner(
  input: PlaceholderScannerInput,
  runner: Runner = defaultRunner,
): Promise<Result<PlaceholderScannerOutput, PlaceholderScannerError>> {
  const args: readonly string[] = [
    // TODO: scanner-specific args.
    //   - For gitleaks: include '--redact' AND a JSON output flag.
    //   - Never pass --fix, --apply, --commit, --add or any mutation flag.
    input.projectPath,
  ];

  let raw;
  try {
    raw = await runner('placeholder-binary', args, { timeoutMs: 60_000 });
  } catch (e) {
    if (
      e instanceof ScannerNotInstalledError ||
      e instanceof ScannerExecutionError
    ) {
      return err(e);
    }
    return err(
      new ScannerExecutionError('placeholder-binary runner failed', {
        cause: e as Error,
      }),
    );
  }

  // Some scanners (gitleaks) exit non-zero when findings are present. That is
  // a *successful* run, not a failure. Treat as error only the exit codes the
  // scanner's docs say are errors.
  // TODO: implement the per-scanner exit-code policy.

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.stdout);
  } catch (cause) {
    return err(
      new ScannerOutputParseError('placeholder-binary stdout was not valid JSON', {
        cause: cause as Error,
      }),
    );
  }

  // TODO:
  //   1. Narrow `parsed` with a type guard (don't trust scanner output shape).
  //   2. Redact any stray secret-like substrings before populating findings.
  //   3. Shape into PlaceholderScannerOutput.
  // Never include raw secret values in the return value.

  return ok(parsed as PlaceholderScannerOutput);
}
