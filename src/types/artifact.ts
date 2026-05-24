export type ArtifactKind =
  | 'declared_context'
  | 'evidence_inventory'
  | 'scanner_findings'
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
