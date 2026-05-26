/**
 * Mode B (sandbox_active_validation) CLI surface (step 2.11).
 *
 * Lifts Phase 1 step 03's parse-time rejection of Mode B. Adds:
 *  - `--supabase-sandbox <project_ref>` (required for Mode B)
 *  - `--supabase-service-role-key <env_var_name>` (env-var NAME only;
 *    the parser rejects anything that looks like a key value)
 *  - `--approve-active` (gates Mode B; interactive confirmation also
 *    required unless `--ci`)
 *  - `--ci` (CI mode; expects `--approval-file`)
 *  - `--approval-file <path>` (signed approval per step 2.01 decision 5)
 *
 * Approval-file format (step 2.01 decision 5 Option A — JSON +
 * minisign):
 *   {
 *     "scan_id_prefix": "veyra-",
 *     "granted_at": "2026-05-26T00:00:00Z",
 *     "granted_by": "release-manager@example.invalid",
 *     "scope": {
 *       "project_ref": "<sandbox-ref>",
 *       "max_synthetic_records": 100,
 *       "expires_at": "2026-06-26T00:00:00Z",
 *       "max_scans": 10
 *     },
 *     "signature": "<base64-encoded minisign signature>"
 *   }
 *
 * The minisign signature is verified against a public key the
 * deployment trusts. Step 2.11 ships the file-shape parser + the
 * scope/expiry/counter gates; the cryptographic verification is a
 * stub returning "skipped" with a warning marker — real Ed25519
 * verification lands in a follow-up step (the minisign npm library
 * pick was deferred from 2.01 to 2.11; 2.11 records the choice in
 * decisions.md once an npm library is picked).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { type Result, err, ok } from '../types/result.js';

export class ModeBConfigurationError extends Error {
  override readonly name = 'ModeBConfigurationError';
}

export class ApprovalFileError extends Error {
  override readonly name = 'ApprovalFileError';
}

export interface ApprovalFile {
  readonly scan_id_prefix: string;
  readonly granted_at: string;
  readonly granted_by: string;
  readonly scope: {
    readonly project_ref: string;
    readonly max_synthetic_records: number;
    readonly expires_at: string;
    readonly max_scans: number;
  };
  readonly signature?: string;
}

export interface ApprovalUsage {
  readonly approval_path: string;
  readonly scans_consumed: number;
  readonly last_consumed_at?: string;
}

/**
 * Heuristic: rejects argv values that look like API keys instead of
 * env-var NAMES. The flag is documented as taking an env-var name —
 * we expect `VEYRA_SERVICE_ROLE_KEY`-shaped strings, not `eyJh...` JWT
 * blobs.
 */
export function looksLikeKeyValue(value: string): boolean {
  if (value.length > 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value)) {
    // Long high-entropy string with no spaces — likely a key value.
    return true;
  }
  // Common credential prefixes (sigil-style: sk-, eyJ JWT, sb_, sbp_).
  if (/^(sk-|eyJ|sb_|sbp_)/.test(value)) return true;
  return false;
}

const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function isValidEnvVarName(value: string): boolean {
  return ENV_VAR_NAME_PATTERN.test(value);
}

export async function readApprovalFile(
  filePath: string,
): Promise<Result<ApprovalFile, ApprovalFileError>> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new ApprovalFileError(`approval-file ${filePath} could not be read: ${m}`));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new ApprovalFileError(`approval-file ${filePath} is not valid JSON: ${m}`));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return err(new ApprovalFileError(`approval-file ${filePath} must be a JSON object`));
  }
  const r = parsed as Record<string, unknown>;
  const scope = r['scope'];
  if (
    typeof r['scan_id_prefix'] !== 'string' ||
    typeof r['granted_at'] !== 'string' ||
    typeof r['granted_by'] !== 'string' ||
    typeof scope !== 'object' ||
    scope === null
  ) {
    return err(new ApprovalFileError(`approval-file ${filePath} missing required fields`));
  }
  const s = scope as Record<string, unknown>;
  if (
    typeof s['project_ref'] !== 'string' ||
    typeof s['max_synthetic_records'] !== 'number' ||
    typeof s['expires_at'] !== 'string' ||
    typeof s['max_scans'] !== 'number'
  ) {
    return err(new ApprovalFileError(`approval-file ${filePath} scope missing required fields`));
  }
  return ok({
    scan_id_prefix: r['scan_id_prefix'] as string,
    granted_at: r['granted_at'] as string,
    granted_by: r['granted_by'] as string,
    scope: {
      project_ref: s['project_ref'] as string,
      max_synthetic_records: s['max_synthetic_records'] as number,
      expires_at: s['expires_at'] as string,
      max_scans: s['max_scans'] as number,
    },
    ...(typeof r['signature'] === 'string' ? { signature: r['signature'] as string } : {}),
  });
}

export interface ApprovalGateInputs {
  readonly approvalFilePath: string;
  readonly approvalFile: ApprovalFile;
  readonly supabaseSandboxRef: string;
  readonly now: Date;
}

export interface ApprovalGateOutcome {
  readonly approved: boolean;
  readonly reason?: string;
  readonly usageCounterPath: string;
  readonly scansAfterConsume: number;
}

/**
 * Codex retro 2.11-approval-signature-not-verified: signature
 * verification stub. The real verification (Ed25519 minisign
 * against a trusted public key) lands when the specific minisign
 * npm library is picked (step 2.01 decision 5 picked the
 * technology; library deferred). Until then, this function returns
 * a clearly-marked "not verified" outcome that the gate routes to
 * a refusal UNLESS the caller passes `skipSignatureVerify: true`
 * to opt out for environments where the approval file is
 * integrity-trusted out-of-band (e.g. baked into a secrets manager).
 */
export interface SignatureVerifyOutcome {
  readonly verified: boolean;
  readonly reason: string;
}

export function verifySignature(approvalFile: ApprovalFile): SignatureVerifyOutcome {
  if (approvalFile.signature === undefined || approvalFile.signature.length === 0) {
    return {
      verified: false,
      reason: 'approval-file has no signature field',
    };
  }
  return {
    verified: false,
    reason:
      'minisign Ed25519 verification is deferred (codex retro 2.11). Pass --skip-signature-verify only when the approval file is integrity-trusted out-of-band.',
  };
}

export async function checkApprovalAndConsume(
  inputs: ApprovalGateInputs & {
    readonly skipSignatureVerify?: boolean;
    /** Number of synthetic records the compiled plan would create. */
    readonly maxSyntheticRecordsRequested?: number;
  },
): Promise<Result<ApprovalGateOutcome, ApprovalFileError>> {
  // Codex retro 2.11-approval-signature-not-verified: signature
  // check is opt-out-able while the verify implementation is
  // deferred.
  if (inputs.skipSignatureVerify !== true) {
    const sig = verifySignature(inputs.approvalFile);
    if (!sig.verified) {
      return err(
        new ApprovalFileError(
          `approval-file signature not verified: ${sig.reason}`,
        ),
      );
    }
  }
  // Codex retro 2.11: enforce max_synthetic_records when the caller
  // supplies the proposed plan's record count.
  if (
    inputs.maxSyntheticRecordsRequested !== undefined &&
    inputs.maxSyntheticRecordsRequested >
      inputs.approvalFile.scope.max_synthetic_records
  ) {
    return err(
      new ApprovalFileError(
        `approval-file scope.max_synthetic_records=${String(inputs.approvalFile.scope.max_synthetic_records)} exceeded by proposed plan (${String(inputs.maxSyntheticRecordsRequested)} requested)`,
      ),
    );
  }
  const af = inputs.approvalFile;
  // Scope check.
  if (af.scope.project_ref !== inputs.supabaseSandboxRef) {
    return err(
      new ApprovalFileError(
        `approval-file scope.project_ref "${af.scope.project_ref}" does not match --supabase-sandbox "${inputs.supabaseSandboxRef}"`,
      ),
    );
  }
  // Expiry check.
  const expiresAt = new Date(af.scope.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return err(new ApprovalFileError(`approval-file expires_at "${af.scope.expires_at}" is not a valid ISO date`));
  }
  if (inputs.now.getTime() > expiresAt.getTime()) {
    return err(new ApprovalFileError(`approval-file expired at ${af.scope.expires_at} (current time ${inputs.now.toISOString()})`));
  }
  // Counter check.
  const usagePath = `${inputs.approvalFilePath}.usage.json`;
  let usage: ApprovalUsage = {
    approval_path: inputs.approvalFilePath,
    scans_consumed: 0,
  };
  try {
    const t = await fs.readFile(usagePath, 'utf8');
    const u = JSON.parse(t) as Record<string, unknown>;
    if (typeof u['scans_consumed'] === 'number') {
      usage = {
        approval_path: inputs.approvalFilePath,
        scans_consumed: u['scans_consumed'] as number,
        ...(typeof u['last_consumed_at'] === 'string'
          ? { last_consumed_at: u['last_consumed_at'] as string }
          : {}),
      };
    }
  } catch {
    // Missing counter is fine — first scan.
  }
  if (usage.scans_consumed >= af.scope.max_scans) {
    return err(new ApprovalFileError(`approval-file max_scans reached (${String(af.scope.max_scans)}); rotate the approval or revoke`));
  }
  // Increment counter.
  const next: ApprovalUsage = {
    approval_path: inputs.approvalFilePath,
    scans_consumed: usage.scans_consumed + 1,
    last_consumed_at: inputs.now.toISOString(),
  };
  await fs.mkdir(path.dirname(usagePath), { recursive: true });
  await fs.writeFile(usagePath, JSON.stringify(next, null, 2), 'utf8');

  return ok({
    approved: true,
    usageCounterPath: usagePath,
    scansAfterConsume: next.scans_consumed,
  });
}

/**
 * Interactive confirmation string the user must type verbatim before
 * Synthesize. Per step 2.11: refuse to proceed on any other input.
 */
export const MODE_B_CONFIRMATION_PHRASE = 'yes-i-understand-this-mutates-sandbox';

export function isAcceptedConfirmation(input: string): boolean {
  return input.trim() === MODE_B_CONFIRMATION_PHRASE;
}
