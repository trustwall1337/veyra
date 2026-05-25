export type ArtifactKind =
  | 'declared_context'
  | 'evidence_inventory'
  // `scan_facts` replaces the pre-revision `scanner_findings` artifact
  // per AI-shape revision §9 Option B (clean break landing in step 08b).
  | 'scan_facts'
  // Hypothesis artifacts emitted by the AI Inference Agent (08d). The
  // orchestrator (18b) consumes these; downstream Pass-1/Pass-2
  // assertion does the deterministic dispatch into Findings.
  | 'hypotheses'
  | 'context_requests'
  | 'control_cards'
  | 'veyra_report_json'
  | 'veyra_report_md';

export interface ArtifactRef<K extends ArtifactKind = ArtifactKind> {
  readonly scanId: string;
  readonly kind: K;
  readonly path: string;
}

export interface Artifact<T> {
  readonly ref: ArtifactRef;
  readonly value: T;
  readonly written_at: string;
}
