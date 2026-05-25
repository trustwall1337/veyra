import type { HypothesisRef } from './hypothesis.js';

export type FindingType =
  | 'confirmed_issue'
  | 'likely_issue'
  | 'missing_evidence'
  | 'coverage_gap'
  | 'informational';

export type EvidenceStrength = 'low' | 'medium' | 'high';

export type Reproducibility =
  | 'static'
  | 'mcp_context'
  | 'tool_output'
  | 'manual_review_required';

export type ReviewAction =
  | 'fix_before_launch'
  | 'review_before_launch'
  | 'add_test'
  | 'monitor'
  | 'accept_with_owner';

export type BlastRadius =
  | 'secrets'
  | 'user_data'
  | 'tenant_data'
  | 'admin_access'
  | 'financial_data'
  | 'private_files'
  | 'availability'
  | 'unknown';

export interface Finding {
  readonly id: string;
  readonly control_id: string;
  readonly finding_type: FindingType;
  readonly evidence_strength: EvidenceStrength;
  readonly reproducibility: Reproducibility;
  readonly review_action: ReviewAction;
  readonly blast_radius: BlastRadius;
  readonly title: string;
  readonly summary: string;
  /**
   * Per AI-shape revision §3.3: `evidence_refs` is fact-only. Each
   * string is a `ScanFact.fact_id`. Hypotheses attach via the
   * separate `supporting_hypothesis_refs` field below — they are
   * never counted as evidence.
   */
  readonly evidence_refs: readonly string[];
  readonly suggested_test_ids?: readonly string[];
  /**
   * Hypotheses the disposition pass attached to this Finding. Used by
   * the reporter to show "the AI also saw this" alongside the
   * deterministic verdict. Absence does not change the Finding's
   * classification.
   *
   * Added in step 02b for revision §3.3 + §4.2 rule 1.
   */
  readonly supporting_hypothesis_refs?: readonly HypothesisRef[];
}
