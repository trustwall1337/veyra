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
  | 'veyra_report_md'
  // Phase 3 (Agentic Veyra) additive kinds — PLAN §F/§K + step 30. The loop's
  // append-only audit trail, the per-tool failure + result-reject records, the
  // checked-in required-evidence ledger, the redaction alias map, and the
  // bounded deep-dive sub-agent error record (decisions.md D6). Additive only:
  // no existing kind is renamed or removed.
  | 'loop_trace'
  | 'tool_error'
  | 'tool_result_reject'
  | 'required_evidence_ledger'
  | 'redaction_alias_map'
  | 'subagent_error';

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
