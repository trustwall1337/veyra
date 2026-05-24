import type { ConnectorId, ScannerId } from './identity.js';

export interface StaticCodeEvidence {
  readonly id: string;
  readonly source: 'static_code';
  readonly file: string;
  readonly line?: number;
  readonly excerpt?: string;
}

export interface McpContextEvidence {
  readonly id: string;
  readonly source: 'mcp_context';
  readonly server: ConnectorId;
  readonly tool: string;
  readonly request_fingerprint: string;
}

export interface ScannerEvidence {
  readonly id: string;
  readonly source: 'scanner';
  readonly scanner: ScannerId;
  readonly finding_id: string;
}

/** Phase 2 — type only; no Phase 1 code emits or handles this variant. */
export interface ActiveValidationEvidence {
  readonly id: string;
  readonly source: 'active_validation';
  readonly test_id: string;
  readonly outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
  readonly synthetic_data_refs: readonly string[];
}

/** Phase 2 — type only; no Phase 1 code emits or handles this variant. */
export interface CleanupProofEvidence {
  readonly id: string;
  readonly source: 'cleanup_proof';
  readonly scan_id: string;
  readonly residual_count: number;
}

export type EvidenceItem =
  | StaticCodeEvidence
  | McpContextEvidence
  | ScannerEvidence
  | ActiveValidationEvidence
  | CleanupProofEvidence;

export type EvidenceKind = EvidenceItem['source'];

/**
 * Compile-time exhaustiveness helper. Any switch over EvidenceItem.source
 * that hits a default branch must call this. When a new EvidenceKind is
 * added, the compiler refuses callers that fail to extend their switch.
 */
export function assertExhaustive(x: never): never {
  throw new Error(`Unhandled evidence kind: ${JSON.stringify(x)}`);
}
