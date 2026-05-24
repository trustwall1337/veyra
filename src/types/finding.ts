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
  readonly evidence_refs: readonly string[];
  readonly suggested_test_ids?: readonly string[];
}
