import type { ClaimRecord } from '../../types/claim-record.js';
import type { Finding } from '../../types/finding.js';

import { lookupTemplate } from './templates.js';

/**
 * Deterministic claim-linter (Phase 3 / Step 36). Every material sentence in
 * the rendered narrative must cite a resolvable fact / finding / predicate
 * output. A failed lint rejects the ENTIRE narrative — the renderer falls
 * back to a deterministic skeleton (PLAN-v1 §D.A hard-fail semantics).
 */

export type LintFailure =
  | { readonly kind: 'unknown_claim_type'; readonly claim_type: string }
  | { readonly kind: 'unknown_predicate_kind'; readonly claim_type: string; readonly predicate_kind: string }
  | { readonly kind: 'unresolved_subject'; readonly subject_id: string }
  | { readonly kind: 'unresolved_predicate_output'; readonly predicate_output_id: string }
  | { readonly kind: 'no_supporting_refs' }
  | { readonly kind: 'unresolved_supporting_ref'; readonly ref: string }
  | { readonly kind: 'missing_template' }
  | { readonly kind: 'missing_required_param'; readonly param: string }
  | { readonly kind: 'unstructured_template_param'; readonly param: string };

export interface LintReport {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<{
    readonly claim: ClaimRecord;
    readonly failure: LintFailure;
  }>;
}

export interface LintContext {
  /** Resolvable subject ids (e.g. control ids, table names, fact ids). */
  readonly subjects: ReadonlySet<string>;
  /** Resolvable predicate output ids (Finding ids, ledger baseline ids, ...). */
  readonly predicate_outputs: ReadonlySet<string>;
  /** Resolvable artifact refs (artifact basenames, fact ids). */
  readonly artifact_refs: ReadonlySet<string>;
}

const KNOWN_CLAIM_TYPES: ReadonlySet<string> = new Set([
  'baseline_unmet',
  'likely_issue',
  'informational',
]);

/** Build a lint context from a list of findings + ledger baseline ids. */
export function lintContextFromFindings(
  findings: readonly Finding[],
  ledger_baseline_ids: readonly string[],
  artifact_refs: readonly string[],
): LintContext {
  return {
    subjects: new Set([
      ...findings.map((f) => f.control_id),
      ...ledger_baseline_ids,
    ]),
    predicate_outputs: new Set([
      ...findings.map((f) => f.id),
      ...ledger_baseline_ids,
    ]),
    // Findings + their `evidence_refs` are themselves valid citation targets
    // (a claim about a finding can cite the finding's id and the underlying
    // facts). The explicit `artifact_refs` argument adds artifact basenames.
    artifact_refs: new Set([
      ...findings.map((f) => f.id),
      ...findings.flatMap((f) => f.evidence_refs),
      ...artifact_refs,
    ]),
  };
}

/** Lint a list of claims; reports the first failure per claim (if any). */
export function lintClaims(
  claims: readonly ClaimRecord[],
  context: LintContext,
): LintReport {
  const failures: { claim: ClaimRecord; failure: LintFailure }[] = [];
  for (const claim of claims) {
    const f = lintOne(claim, context);
    if (f !== undefined) failures.push({ claim, failure: f });
  }
  return { ok: failures.length === 0, failures };
}

function lintOne(claim: ClaimRecord, ctx: LintContext): LintFailure | undefined {
  if (!KNOWN_CLAIM_TYPES.has(claim.claim_type)) {
    return { kind: 'unknown_claim_type', claim_type: claim.claim_type };
  }
  if (!ctx.subjects.has(claim.subject_id)) {
    return { kind: 'unresolved_subject', subject_id: claim.subject_id };
  }
  if (!ctx.predicate_outputs.has(claim.predicate_output_id)) {
    return {
      kind: 'unresolved_predicate_output',
      predicate_output_id: claim.predicate_output_id,
    };
  }
  if (claim.supporting_artifact_refs.length === 0) {
    return { kind: 'no_supporting_refs' };
  }
  for (const ref of claim.supporting_artifact_refs) {
    if (!ctx.artifact_refs.has(ref)) {
      return { kind: 'unresolved_supporting_ref', ref };
    }
  }
  const template = lookupTemplate(claim.claim_type, claim.predicate_kind);
  if (template === undefined) {
    return { kind: 'missing_template' };
  }
  for (const required of template.required_params) {
    const value = claim.template_params[required];
    if (value === undefined) {
      return { kind: 'missing_required_param', param: required };
    }
    if (typeof value !== 'string') {
      return { kind: 'unstructured_template_param', param: required };
    }
  }
  return undefined;
}
