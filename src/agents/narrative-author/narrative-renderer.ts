import type { ClaimRecord } from '../../types/claim-record.js';
import type { Finding } from '../../types/finding.js';

import { type LintReport, lintClaims, type LintContext } from './claim-linter.js';
import { lookupTemplate } from './templates.js';

/**
 * Pure deterministic narrative renderer (Phase 3 / Step 36, PLAN-v1 §D.A).
 * Same records + same templates → same prose, byte-identical. The renderer is
 * the SOLE prose source — AI never emits sentences, only structured
 * {@link ClaimRecord}s.
 *
 * Hard-fail semantics: if the claim-linter rejects ANY record, the entire
 * narrative is replaced by the deterministic fallback skeleton — uncited
 * claims are NEVER rendered as prose.
 */

export interface NarrativeRenderResult {
  readonly prose: string;
  readonly used_fallback: boolean;
  readonly lint: LintReport;
}

/** Render the narrative from a vetted claim list. */
export function renderNarrative(
  claims: readonly ClaimRecord[],
  context: LintContext,
  findings: readonly Finding[],
): NarrativeRenderResult {
  const lint = lintClaims(claims, context);
  if (!lint.ok) {
    return {
      prose: deterministicFallback(findings),
      used_fallback: true,
      lint,
    };
  }
  const lines: string[] = [];
  for (const claim of claims) {
    const template = lookupTemplate(claim.claim_type, claim.predicate_kind);
    if (template === undefined) {
      // Defensive: linter already rejected this case; keep deterministic.
      continue;
    }
    lines.push(substitute(template.template, claim.template_params));
  }
  return {
    prose: lines.join('\n'),
    used_fallback: false,
    lint,
  };
}

function substitute(
  template: string,
  params: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_match, key: string) => {
    const value = params[key];
    return value !== undefined ? value : `{${key}}`;
  });
}

/**
 * Deterministic fallback narrative — used when the claim-linter rejects.
 * Allowed-claim vocabulary only.
 */
export function deterministicFallback(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return 'No findings were produced; nothing was found that appears launch-blocking.';
  }
  const blockers = findings.filter(
    (f) => f.review_action === 'fix_before_launch',
  );
  const review = findings.filter(
    (f) => f.review_action === 'review_before_launch',
  );
  const parts: string[] = [];
  if (blockers.length > 0) {
    parts.push(
      `${String(blockers.length)} finding(s) appear launch-blocking and need human review.`,
    );
  }
  if (review.length > 0) {
    parts.push(
      `${String(review.length)} finding(s) need human review before launch.`,
    );
  }
  if (parts.length === 0) {
    parts.push('Findings were checked; none appear launch-blocking.');
  }
  return parts.join('\n');
}
