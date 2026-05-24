import { spawn } from 'node:child_process';

import {
  ScannerExecutionError,
  ScannerNotInstalledError,
} from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';

import { parseSemgrepJson } from './parser.js';
import type {
  SemgrepError,
  SemgrepInput,
  SemgrepOutput,
  SemgrepRunner,
  SemgrepRunnerResult,
} from './types.js';

const SCANNER = 'semgrep';
const BINARY = 'semgrep';
const DEFAULT_TIMEOUT_MS = 120_000;
const INSTALL_HINT =
  'macOS: `brew install semgrep`. pipx: `pipx install semgrep`. Docs: https://semgrep.dev/docs/getting-started/cli';

const DEFAULT_RUNNER: SemgrepRunner = (binary, args, opts) =>
  new Promise<SemgrepRunnerResult>((resolve, reject) => {
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
 * Build the argv passed to the semgrep binary. Exported so tests can assert
 * the step 07 Done-When + Guardrail constraints:
 *
 *  - `--config <rulesPath>` so semgrep only uses Veyra's bundled rules
 *    (never a registry bundle, never `--config auto`)
 *  - `--json` so the adapter parses JSON, never human-readable output
 *  - `--no-rewrite-rule-ids` so check_id stays as written in the YAML
 *    (predictable cc-11-N mapping in the consuming agent)
 *  - `--quiet` so progress banners don't end up in stderr we'd then
 *    surface to the user
 *  - `--metrics=off` so no telemetry leaves the machine
 *  - no `--autofix`, no `--pro`, no `ci` subcommand — read-only,
 *    deterministic-YAML only per step 07 Guardrails + FPP §18.
 */
export function buildSemgrepArgs(input: SemgrepInput): readonly string[] {
  return [
    'scan',
    '--config',
    input.rulesPath,
    '--json',
    '--no-rewrite-rule-ids',
    '--quiet',
    '--metrics=off',
    input.projectPath,
  ];
}

/**
 * Run semgrep against `input.projectPath` with rules loaded from
 * `input.rulesPath`, and return normalized findings.
 *
 * Step 07 contract: tests inject `runner`; the real binary is not invoked
 * by the test suite. Step 07 verification additionally runs
 * `semgrep --test rules/` to validate rule fixtures — that's
 * separate from this adapter.
 */
export async function runSemgrep(
  input: SemgrepInput,
  runner: SemgrepRunner = DEFAULT_RUNNER,
): Promise<Result<SemgrepOutput, SemgrepError>> {
  const args = buildSemgrepArgs(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: SemgrepRunnerResult;
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

  // `exitCode === null` means the process did not exit normally (killed
  // by signal — typically the spawn `timeout` option). Surface as a
  // typed error rather than silently returning empty findings.
  if (raw.exitCode === null) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        'process did not exit normally (likely killed by timeout or signal)',
      ),
    );
  }

  // Semgrep exit codes: 0 (no findings), 1 (findings present). Both are
  // successful runs. Higher codes are real failures.
  if (raw.exitCode > 1) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        `exited with code ${String(raw.exitCode)}`,
      ),
    );
  }

  const parsed = parseSemgrepJson(raw.stdout);
  if (!parsed.ok) return err(parsed.error);
  return ok(parsed.value);
}
