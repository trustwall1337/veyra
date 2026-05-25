import type { AIConcern } from './ai-concern.js';
import type { EvidenceItem } from './evidence.js';
import type { Finding } from './finding.js';
import type { HypothesisRef } from './hypothesis.js';
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
  /**
   * Hypotheses attached to this control's findings during Pass-2
   * disposition (revision §4.2 rule 1). Advisory only — does not
   * affect `readiness_status`. Added in step 14b.
   */
  readonly supporting_hypothesis_refs?: readonly HypothesisRef[];
  /**
   * AIConcerns linked to this control's `control_id` (revision §11
   * three-tier model). Rendered under "AI-suggested areas for human
   * review" — never mixed with `findings`. Added in step 14b.
   */
  readonly ai_concerns_for_this_control?: readonly AIConcern[];
}
