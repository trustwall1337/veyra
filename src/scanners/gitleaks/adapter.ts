import { spawn } from 'node:child_process';

import {
  ScannerExecutionError,
  ScannerNotInstalledError,
} from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';

import { parseGitleaksJson } from './parser.js';
import type {
  GitleaksError,
  GitleaksInput,
  GitleaksOutput,
  GitleaksRunner,
  GitleaksRunnerResult,
} from './types.js';

const SCANNER = 'gitleaks';
const BINARY = 'gitleaks';
const DEFAULT_TIMEOUT_MS = 60_000;
const INSTALL_HINT =
  'macOS: `brew install gitleaks`. Linux: https://github.com/gitleaks/gitleaks#installing';

/**
 * Real subprocess runner. Tests inject a fake to keep the suite hermetic
 * (see `scan-command.test.ts` style in step 03). Per `CLAUDE.md §Hard rules`:
 *
 *  - uses `spawn` with array args (never `exec`, never a shell string)
 *  - explicit timeout
 *  - ENOENT → typed `ScannerNotInstalledError`, never a generic crash
 */
const DEFAULT_RUNNER: GitleaksRunner = (binary, args, opts) =>
  new Promise<GitleaksRunnerResult>((resolve, reject) => {
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
        reject(new ScannerNotInstalledError(SCANNER, INSTALL_HINT));
        return;
      }
      reject(new ScannerExecutionError(SCANNER, e.message, { cause: e }));
    });
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });

/**
 * Build the argv passed to the gitleaks binary. Exported so tests can assert
 * the `--redact` guardrail (`Done when:` line 26 of the step file).
 *
 * Constraints enforced here (NOT configurable by callers):
 *
 *  - `--redact` is always present (`CLAUDE.md §Secrets`).
 *  - `--report-format json` + `--report-path /dev/stdout` so the adapter
 *    parses stdout. No temp file dance.
 *  - No `--fix` / `--apply` / mutation flag is ever passed
 *    (per skill `new-scanner-adapter §Read-only`).
 */
export function buildGitleaksArgs(input: GitleaksInput): readonly string[] {
  return [
    'detect',
    '--source',
    input.projectPath,
    '--report-format',
    'json',
    '--report-path',
    '/dev/stdout',
    '--redact',
    '--no-banner',
  ];
}

/**
 * Run gitleaks against `input.projectPath` and return normalized, scrubbed
 * findings.
 *
 * Step 05 contract: tests inject `runner`; the real binary is not invoked
 * by the test suite. Phase 1 callers (the tool-runner agent from step 08)
 * pass the default runner.
 */
export async function runGitleaks(
  input: GitleaksInput,
  runner: GitleaksRunner = DEFAULT_RUNNER,
): Promise<Result<GitleaksOutput, GitleaksError>> {
  const args = buildGitleaksArgs(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: GitleaksRunnerResult;
  try {
    raw = await runner(BINARY, args, { timeoutMs });
  } catch (e) {
    if (e instanceof ScannerNotInstalledError) return err(e);
    if (e instanceof ScannerExecutionError) return err(e);
    const message = e instanceof Error ? e.message : String(e);
    const options: ErrorOptions | undefined =
      e instanceof Error ? { cause: e } : undefined;
    return err(new ScannerExecutionError(SCANNER, message, options));
  }

  // `exitCode: null` from `child.on('close', ...)` means the process did not
  // exit normally — killed by signal (most commonly the spawn `timeout`
  // option firing SIGTERM). Surfacing this as a typed error prevents
  // silently returning an empty findings list on a scan that never finished.
  if (raw.exitCode === null) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        'process did not exit normally (likely killed by timeout or signal)',
      ),
    );
  }

  // Gitleaks documented exit codes: 0 (no findings), 1 (findings present).
  // Both are successful runs from our perspective. Anything higher is a
  // real failure (config error, panic, etc.).
  if (raw.exitCode > 1) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        `exited with code ${String(raw.exitCode)}`,
      ),
    );
  }

  const parsed = parseGitleaksJson(raw.stdout);
  if (!parsed.ok) return err(parsed.error);
  return ok({ findings: parsed.value });
}
