import { ScannerOutputParseError } from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';

import type { GitleaksFinding } from './types.js';

/**
 * Patterns the parser scrubs out of any string field it copies from gitleaks
 * stdout. `--redact` in the adapter args should already replace `Match` and
 * `Secret`, but the parser still scrubs defensively — if a future gitleaks
 * version leaks a value into `Description`, `RuleID`, or `Fingerprint`, the
 * adapter still must not surface it.
 *
 * Patterns chosen are the high-confidence vendor-prefix shapes from
 * `FINAL_PRODUCT_PLAN §11` row 8 plus the JWT shape used by Supabase /
 * Auth0 tokens. A high-entropy catch-all would over-match on fingerprints
 * and commit hashes, so we keep the list explicit.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /ghp_[0-9A-Za-z]{36}/g,
  /gho_[0-9A-Za-z]{36}/g,
  /ghu_[0-9A-Za-z]{36}/g,
  /(sk|pk|rk)_(live|test)_[0-9A-Za-z]{16,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

const REDACTED = 'REDACTED';
const SCANNER = 'gitleaks';

/**
 * Replace any secret-pattern substring with the literal "REDACTED". Pure
 * function; idempotent — calling it on an already-scrubbed string yields the
 * same string.
 */
export function redactSecrets(value: string): string {
  let scrubbed = value;
  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }
  return scrubbed;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asLine(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  return 0;
}

/**
 * Parse gitleaks JSON stdout into normalized findings.
 *
 * `Match` and `Secret` fields are read past but never copied into the
 * returned shape; every string we DO copy is passed through
 * {@link redactSecrets}.
 */
export function parseGitleaksJson(
  stdout: string,
): Result<readonly GitleaksFinding[], ScannerOutputParseError> {
  const trimmed = stdout.trim();
  if (trimmed === '') {
    return ok([]);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (cause) {
    return err(
      new ScannerOutputParseError(
        SCANNER,
        `stdout was not valid JSON: ${(cause as Error).message}`,
        { cause: cause as Error },
      ),
    );
  }

  // Some gitleaks versions emit a literal `null` when there are no findings.
  if (raw === null) {
    return ok([]);
  }

  if (!Array.isArray(raw)) {
    return err(
      new ScannerOutputParseError(
        SCANNER,
        `JSON root was not an array (got ${typeof raw})`,
      ),
    );
  }

  const findings: GitleaksFinding[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) {
      return err(
        new ScannerOutputParseError(
          SCANNER,
          'JSON array contained a non-object element',
        ),
      );
    }
    findings.push({
      ruleId: redactSecrets(asString(entry.RuleID, 'unknown-rule')),
      filePath: redactSecrets(asString(entry.File, '<unknown-file>')),
      line: asLine(entry.StartLine),
      description: redactSecrets(asString(entry.Description, '')),
      fingerprint: redactSecrets(asString(entry.Fingerprint, '')),
    });
  }
  return ok(findings);
}
