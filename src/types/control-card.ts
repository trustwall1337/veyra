import type { EvidenceItem } from './evidence.js';
import type { Finding } from './finding.js';
import type { HypothesisRef } from './hypothesis.js';
import type { SuggestedTest } from './suggested-test.js';

/**
 * Lightweight reference to an `AIConcern` by id. Full records live in
 * the `ai-concerns.json` artifact; control cards carry only the id so
 * the report doesn't duplicate the advisory tier into the control-card
 * artifact (revision §11 + step 14b).
 */
export interface AIConcernRef {
  readonly concern_id: string;
}

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
  /** Canonical control description from `controls.ts`. */
  readonly expected_behavior: string;
  /**
   * Display title — defaults to `expected_behavior` but kept separate
   * so the reporter can override per-control if needed.
   */
  readonly title: string;
  readonly readiness_status: ReadinessStatus;
  readonly findings: readonly Finding[];
  /** Full evidence items (heavyweight; persisted in control-cards.json). */
  readonly evidence: readonly EvidenceItem[];
  /**
   * Per FPP §9.3: the card's evidence refs in id-only form. Derived
   * from `evidence` at compose time; kept as a flat string list so
   * downstream consumers can dedupe / link without walking the full
   * evidence objects.
   */
  readonly evidence_refs: readonly string[];
  readonly suggested_tests: readonly SuggestedTest[];
  readonly uncertainty_notes: readonly string[];
  /**
   * Hypotheses attached to this control's findings during Pass-2
   * disposition (revision §4.2 rule 1). Advisory only — does not
   * affect `readiness_status`. Added in step 14b.
   */
  readonly supporting_hypothesis_refs?: readonly HypothesisRef[];
  /**
   * AIConcerns linked to this control's `control_id` by concern_id
   * (full records in `ai-concerns.json`). Rendered under
   * "AI-suggested areas for human review" — never mixed with
   * `findings`. Added in step 14b; switched from embedded objects to
   * refs per the 14b retro-review.
   */
  readonly ai_concerns_for_this_control?: readonly AIConcernRef[];
}
