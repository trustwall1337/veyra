import { ScannerOutputParseError } from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';

import type {
  OsvEvidenceStrength,
  OsvFinding,
  OsvFindingType,
  OsvReviewAction,
} from './types.js';

const SCANNER = 'osv-scanner';

/**
 * Pinned defaults from step 06 Done-When clause:
 *   - dependency findings are tagged `likely_issue` (silence ≠ safe,
 *     presence ≠ exploitable; Guardrails forbid `confirmed_issue`)
 *   - evidence strength is `medium` by default
 *   - review action is `review_before_launch`
 */
const DEFAULT_FINDING_TYPE: OsvFindingType = 'likely_issue';
const DEFAULT_EVIDENCE_STRENGTH: OsvEvidenceStrength = 'medium';
const DEFAULT_REVIEW_ACTION: OsvReviewAction = 'review_before_launch';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Pick the first reported severity string. osv-scanner emits severity as
 * an array of `{ type, score }` objects; this picks the first score
 * regardless of type so the adapter's output stays scalar.
 */
function pickSeverity(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  // `Array.isArray`'s predicate narrows to `any[]`, so an explicit `unknown`
  // annotation keeps the rest of the function in the strict-typing path.
  const first: unknown = raw[0];
  if (!isObject(first)) return undefined;
  return typeof first.score === 'string' ? first.score : undefined;
}

/**
 * Parse osv-scanner JSON stdout into normalized findings.
 *
 * Expected shape (osv-scanner --format json):
 *
 *   {
 *     "results": [
 *       {
 *         "source": { "path": "...", "type": "lockfile" },
 *         "packages": [
 *           {
 *             "package": { "name": "...", "version": "...", "ecosystem": "npm" },
 *             "vulnerabilities": [
 *               { "id": "GHSA-...", "summary": "...", "aliases": ["CVE-..."], "severity": [...] }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * The parser walks `results -> packages -> vulnerabilities` and emits one
 * `OsvFinding` per (package, vulnerability) pair.
 */
export function parseOsvJson(
  stdout: string,
): Result<readonly OsvFinding[], ScannerOutputParseError> {
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

  if (!isObject(raw)) {
    return err(
      new ScannerOutputParseError(
        SCANNER,
        `JSON root was not an object (got ${typeof raw})`,
      ),
    );
  }

  const results = raw.results;
  // osv-scanner may omit `results` entirely when there are no vulns; treat
  // that as an empty list rather than a parse error.
  if (results === undefined) {
    return ok([]);
  }
  if (!Array.isArray(results)) {
    return err(
      new ScannerOutputParseError(SCANNER, '`results` was not an array'),
    );
  }

  const findings: OsvFinding[] = [];
  for (const resultEntry of results) {
    if (!isObject(resultEntry)) continue;
    const packages = resultEntry.packages;
    if (!Array.isArray(packages)) continue;

    for (const pkgEntry of packages) {
      if (!isObject(pkgEntry)) continue;
      const pkg = isObject(pkgEntry.package) ? pkgEntry.package : null;
      if (!pkg) continue;

      const packageName = asString(pkg.name, '<unknown>');
      const packageVersion = asString(pkg.version, '<unknown>');
      const ecosystem = asString(pkg.ecosystem, '<unknown>');

      const vulns = pkgEntry.vulnerabilities;
      if (!Array.isArray(vulns)) continue;

      for (const v of vulns) {
        if (!isObject(v)) continue;
        const vulnerabilityId = asString(v.id, '<unknown>');
        const aliases = asStringArray(v.aliases);
        const summary = asString(v.summary, '');
        const severity = pickSeverity(v.severity);

        findings.push({
          vulnerabilityId,
          aliases,
          packageName,
          packageVersion,
          ecosystem,
          summary,
          ...(severity !== undefined ? { severity } : {}),
          findingType: DEFAULT_FINDING_TYPE,
          evidenceStrength: DEFAULT_EVIDENCE_STRENGTH,
          reviewAction: DEFAULT_REVIEW_ACTION,
        });
      }
    }
  }
  return ok(findings);
}
