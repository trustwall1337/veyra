import { ScannerOutputParseError } from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';

import type {
  SemgrepFinding,
  SemgrepOutput,
  SemgrepSeverity,
} from './types.js';

const SCANNER = 'semgrep';
const ALLOWED_SEVERITIES: readonly SemgrepSeverity[] = [
  'INFO',
  'WARNING',
  'ERROR',
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

function asSeverity(v: unknown): SemgrepSeverity {
  if (typeof v !== 'string') return 'INFO';
  const upper = v.toUpperCase();
  return (ALLOWED_SEVERITIES as readonly string[]).includes(upper)
    ? (upper as SemgrepSeverity)
    : 'INFO';
}

/** Extract `start.line` / `end.line` from a semgrep result entry. */
function readLines(entry: Record<string, unknown>): {
  startLine: number;
  endLine: number;
} {
  const start = isObject(entry.start) ? entry.start : undefined;
  const end = isObject(entry.end) ? entry.end : undefined;
  return {
    startLine: asLine(start?.line),
    endLine: asLine(end?.line),
  };
}

/**
 * Parse `semgrep --json` stdout into normalized findings.
 *
 * Expected shape (semgrep ≥ 1.0):
 *
 *   {
 *     "version": "1.x.x",
 *     "results": [
 *       {
 *         "check_id": "rules.authz.direct-object-access-by-id",
 *         "path": "src/pages/OrderPage.tsx",
 *         "start": { "line": 12 },
 *         "end":   { "line": 18 },
 *         "extra": { "message": "...", "severity": "WARNING" }
 *       }
 *     ],
 *     "errors": [
 *       { "message": "...", "type": "..." }
 *     ]
 *   }
 *
 * Returns the findings plus a list of non-fatal error messages so the
 * consuming agent can decide whether to mark `coverage_gap`.
 */
export function parseSemgrepJson(
  stdout: string,
): Result<SemgrepOutput, ScannerOutputParseError> {
  const trimmed = stdout.trim();
  if (trimmed === '') {
    return ok({ findings: [], nonFatalErrors: [] });
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

  if (!isObject(raw)) {
    return err(
      new ScannerOutputParseError(
        SCANNER,
        `JSON root was not an object (got ${typeof raw})`,
      ),
    );
  }

  const results = raw.results;
  if (results !== undefined && !Array.isArray(results)) {
    return err(
      new ScannerOutputParseError(SCANNER, '`results` was not an array'),
    );
  }

  const findings: SemgrepFinding[] = [];
  if (Array.isArray(results)) {
    for (const entry of results) {
      if (!isObject(entry)) continue;
      const extra = isObject(entry.extra) ? entry.extra : {};
      const { startLine, endLine } = readLines(entry);
      findings.push({
        ruleId: asString(entry.check_id, 'unknown-rule'),
        filePath: asString(entry.path, '<unknown-file>'),
        startLine,
        endLine,
        message: asString(extra.message, ''),
        severity: asSeverity(extra.severity),
      });
    }
  }

  const nonFatalErrors: string[] = [];
  if (Array.isArray(raw.errors)) {
    for (const e of raw.errors) {
      if (isObject(e) && typeof e.message === 'string') {
        nonFatalErrors.push(e.message);
      }
    }
  }

  return ok({ findings, nonFatalErrors });
}
