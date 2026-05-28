/**
 * Structured claim a narrative author emits (Phase 3 / Step 36, carries
 * PLAN-v1 §D.A). The AI (or, in Step 36, the deterministic composer) outputs
 * `ClaimRecord[]` — never free-form prose. A deterministic renderer turns each
 * record into a sentence using a checked-in template. The claim-linter enforces
 * that every material sentence cites a resolvable fact/finding/predicate
 * output before any prose is rendered.
 */
export interface ClaimRecord {
  /** A known claim category (e.g. `'baseline_unmet'`, `'likely_issue'`). */
  readonly claim_type: string;
  /** Which predicate produced the underlying output (e.g. `'coverage_gap'`). */
  readonly predicate_kind: string;
  /** Stable id of the subject the claim is about (table, control, etc.). */
  readonly subject_id: string;
  /**
   * Id of the predicate output this claim is asserting against
   * (a `Finding.id`, a `LedgerGap.baseline_item_id`, etc.). The linter rejects
   * the record unless this resolves in the supplied resolver context.
   */
  readonly predicate_output_id: string;
  /**
   * Artifact / fact references that support the claim. Non-empty; every entry
   * must resolve, or the linter rejects.
   */
  readonly supporting_artifact_refs: readonly string[];
  /**
   * Template parameters — STRUCTURED ONLY (string scalars). Free-form prose
   * is forbidden here; that is what the renderer + template are for.
   */
  readonly template_params: Readonly<Record<string, string>>;
}
