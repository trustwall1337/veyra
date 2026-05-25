import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { redactSecrets as sanitizeForStorage } from '../../ai/sanitization.js';
import { registry } from '../../core/registry/service-registry.js';
import {
  ScannerExecutionError,
  ScannerNotInstalledError,
} from '../../types/errors.js';
import { asScannerId, type ScannerId } from '../../types/identity.js';
import { type Result, err, ok } from '../../types/result.js';
import type {
  ScanFact,
  ScanFactPayload,
} from '../../types/scan-fact.js';

import { parseGitleaksJson } from './parser.js';
import type {
  GitleaksError,
  GitleaksInput,
  GitleaksMatch,
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
 * Opaque scanner id minted via {@link asScannerId}. Per FPP §2A the
 * adapter never names this string anywhere downstream; consumers ask
 * the service registry to resolve it.
 */
function mintScannerId(): ScannerId {
  const r = asScannerId('gitleaks');
  if (!r.ok) {
    throw new Error(
      `gitleaks adapter: invalid hardcoded scanner id: ${r.error.message}`,
    );
  }
  return r.value;
}

export const GITLEAKS_SCANNER_ID: ScannerId = mintScannerId();

// Module-load registration. Real failures (id collision with a
// different descriptor) surface as a thrown error so the developer sees
// them at boot. A second registration with the same id from a re-import
// would also collide; Node ESM caches modules so this should not happen
// in practice — if it does, the conflict is the signal.
const _registration = registry.registerScanner({
  id: GITLEAKS_SCANNER_ID,
  displayName: 'Gitleaks',
});
if (!_registration.ok) {
  throw new Error(
    `gitleaks adapter: failed to register with ServiceRegistry: ${_registration.error.message}`,
  );
}

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

  // Compute one args fingerprint per scan; every fact from this run
  // shares it (so consumers can group facts by invocation).
  const argsFingerprint = sha256(JSON.stringify({ binary: BINARY, args }));
  const observedAt = new Date().toISOString();
  const facts = parsed.value.map((m) =>
    buildScanFact(m, argsFingerprint, observedAt),
  );

  return ok({ findings: parsed.value, facts });
}

/**
 * Wrap one normalized gitleaks match into a generic `ScanFact`. The
 * `sanitized_excerpt` runs through the 02c AI-sanitization helper as a
 * second defensive scrub (parser → 02c). Even if the parser missed a
 * pattern, 02c's broader regex set catches it before storage. The
 * gitleaks-already-redacted `Match` field is included when available
 * so downstream consumers see what gitleaks saw (in scrubbed form),
 * along with `byte_range` when gitleaks emits column positions.
 */
function buildScanFact(
  match: GitleaksMatch,
  argsFingerprint: string,
  observedAt: string,
): ScanFact {
  const excerptParts: readonly string[] = [
    `${match.ruleId}: ${match.description}`,
    match.redactedMatch !== undefined ? `match=${match.redactedMatch}` : '',
  ].filter((s) => s.length > 0);
  // `sanitizeForStorage` returns a `SanitizedMessage` brand; we widen
  // back to string because the ScanFactPayload field is plain string.
  // The brand's role is to prevent direct AI-prompt leakage; storage
  // shape doesn't carry the brand.
  const sanitized: string = sanitizeForStorage(excerptParts.join(' | '));
  const payload: ScanFactPayload = {
    sanitized_excerpt: sanitized,
    content_kind: 'redacted_secret_context',
    ...(match.byteRange !== undefined ? { byte_range: match.byteRange } : {}),
  };
  const factId = sha256(
    `${GITLEAKS_SCANNER_ID as string}:${match.filePath}:${String(match.line)}:${match.fingerprint}`,
  );
  return {
    fact_id: factId,
    source: {
      kind: 'scanner_match',
      scanner_id: GITLEAKS_SCANNER_ID,
      payload,
    },
    file_path: match.filePath,
    line: match.line,
    observed_at: observedAt,
    args_fingerprint_sha256: argsFingerprint,
    redacted: true,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
