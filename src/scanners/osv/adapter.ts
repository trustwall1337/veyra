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

import { parseOsvJson } from './parser.js';
import type {
  OsvError,
  OsvFinding,
  OsvInput,
  OsvOutput,
  OsvRunner,
  OsvRunnerResult,
} from './types.js';

const SCANNER = 'osv-scanner';
const BINARY = 'osv-scanner';
const DEFAULT_TIMEOUT_MS = 60_000;
const INSTALL_HINT =
  'macOS: `brew install osv-scanner`. Linux: https://google.github.io/osv-scanner/installation/';

function mintScannerId(): ScannerId {
  const r = asScannerId('osv');
  if (!r.ok) {
    throw new Error(
      `osv adapter: invalid hardcoded scanner id: ${r.error.message}`,
    );
  }
  return r.value;
}

export const OSV_SCANNER_ID: ScannerId = mintScannerId();

const _registration = registry.registerScanner({
  id: OSV_SCANNER_ID,
  displayName: 'OSV-Scanner',
});
if (!_registration.ok) {
  throw new Error(
    `osv adapter: failed to register with ServiceRegistry: ${_registration.error.message}`,
  );
}

/**
 * Real subprocess runner. Tests inject a fake to keep the suite hermetic.
 * Per `CLAUDE.md §Hard rules`:
 *
 *  - uses `spawn` with array args (never `exec`, never a shell string)
 *  - explicit timeout
 *  - ENOENT → typed `ScannerNotInstalledError`, never a generic crash
 */
const DEFAULT_RUNNER: OsvRunner = (binary, args, opts) =>
  new Promise<OsvRunnerResult>((resolve, reject) => {
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
 * Build the argv passed to osv-scanner. Exported so tests can assert the
 * step's Done-When constraints:
 *
 *  - `--format json` so we parse JSON, never human-readable output
 *  - `--lockfile <path>` so the adapter scans only the file it was handed
 *    (the Done-When clause forbids the adapter from traversing the
 *    project file system on its own)
 *  - no `--source`, no `-r`, no recursive scan flags
 */
export function buildOsvArgs(input: OsvInput): readonly string[] {
  return ['--format', 'json', '--lockfile', input.lockfilePath];
}

/**
 * Run osv-scanner against `input.lockfilePath` and return normalized
 * findings, each tagged with `findingType: 'likely_issue'`,
 * `evidenceStrength: 'medium'`, and `reviewAction: 'review_before_launch'`
 * per the step 06 Done-When clause.
 *
 * Tests inject `runner`; the real binary is not invoked by the test suite.
 */
export async function runOsv(
  input: OsvInput,
  runner: OsvRunner = DEFAULT_RUNNER,
): Promise<Result<OsvOutput, OsvError>> {
  const args = buildOsvArgs(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let raw: OsvRunnerResult;
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

  // `exitCode === null` from `child.on('close', ...)` means the process did
  // not exit normally (killed by signal, most commonly the spawn `timeout`
  // option). Surface as a typed error rather than silently returning empty
  // findings.
  if (raw.exitCode === null) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        'process did not exit normally (likely killed by timeout or signal)',
      ),
    );
  }

  // osv-scanner exit codes: 0 (no vulnerabilities), 1 (vulnerabilities
  // present). Both are successful runs. Anything higher is a real failure.
  if (raw.exitCode > 1) {
    return err(
      new ScannerExecutionError(
        SCANNER,
        `exited with code ${String(raw.exitCode)}`,
      ),
    );
  }

  const parsed = parseOsvJson(raw.stdout);
  if (!parsed.ok) return err(parsed.error);

  const argsFingerprint = sha256(JSON.stringify({ binary: BINARY, args }));
  const observedAt = new Date().toISOString();
  const facts = parsed.value.map((f) =>
    buildScanFact(f, input.lockfilePath, argsFingerprint, observedAt),
  );

  return ok({ findings: parsed.value, facts });
}

/**
 * Wrap one normalized OSV finding into a generic `ScanFact`. The OSV
 * adapter's payload is `content_kind: 'text'` (advisory metadata, not
 * secret-bearing content); `redacted` is `false` because there is no
 * secret content in the OSV report to begin with. The sanitized excerpt
 * still passes through 02c `redactSecrets` defensively — an advisory
 * summary should never contain a credential, but pinning the boundary
 * makes that explicit.
 */
function buildScanFact(
  finding: OsvFinding,
  lockfilePath: string,
  argsFingerprint: string,
  observedAt: string,
): ScanFact {
  const excerpt = `${finding.vulnerabilityId} ${finding.packageName}@${finding.packageVersion} — ${finding.summary}`;
  const sanitized: string = sanitizeForStorage(excerpt);
  const payload: ScanFactPayload = {
    sanitized_excerpt: sanitized,
    content_kind: 'text',
  };
  const factId = sha256(
    `${OSV_SCANNER_ID as string}:${lockfilePath}:${finding.vulnerabilityId}:${finding.packageName}@${finding.packageVersion}`,
  );
  return {
    fact_id: factId,
    source: {
      kind: 'scanner_match',
      scanner_id: OSV_SCANNER_ID,
      payload,
    },
    file_path: lockfilePath,
    observed_at: observedAt,
    args_fingerprint_sha256: argsFingerprint,
    redacted: false,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
