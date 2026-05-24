import type { EvidenceItem } from './evidence.js';
import type { Finding } from './finding.js';
import type { SuggestedTest } from './suggested-test.js';

/**
 * `proven_in_sandbox` is reserved for Phase 2 active validation. Phase 1
 * code never emits it; readers should treat it as "future-only" until
 * Phase 2 lands the active-validation pathway.
 */
export type ReadinessStatus =
  | 'launch_blocker'
  | 'needs_review'
  | 'evidence_present'
  | 'proven_in_sandbox';

export interface ControlCard {
  readonly control_id: string;
  readonly title: string;
  readonly readiness_status: ReadinessStatus;
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceItem[];
  readonly suggested_tests: readonly SuggestedTest[];
  readonly uncertainty_notes: readonly string[];
}
