import type { Finding } from '../../types/finding.js';

/**
 * Deterministic probe outcome classifier (Phase 3 / Step 39). Joins the floor
 * (Step 35 pattern): runs AFTER the loop, never inside. The classifier inputs
 * are facts the loop recorded (response status, response body shape — all
 * redacted via the loop-view redactor before reaching here) plus the probe's
 * intent ("expected to be denied" / "expected to be allowed").
 *
 * Outputs are the three classes PLAN-v1 §D.F + the active-validation rules
 * agreed in Phase 2 step 10: `proven_denial`, `proven_allowed`, `inconclusive`.
 * Wording uses the allowed-claim vocabulary only.
 */

export type ProbeOutcome = 'proven_denial' | 'proven_allowed' | 'inconclusive';

export interface ProbeObservation {
  readonly probe_id: string;
  readonly control_id: string;
  readonly response_status?: number;
  /**
   * Whether the response body had data the probe was trying to expose
   * (e.g. row leak). The fact-extractor (Step 33 read tools / sandbox-runner
   * fact half) computes this deterministically.
   */
  readonly response_returned_rows?: boolean;
  /** What the probe was asserting — denial was the expected outcome. */
  readonly expectation: 'expect_denial' | 'expect_allow';
}

/** Classify ONE probe observation deterministically. */
export function classifyProbe(obs: ProbeObservation): ProbeOutcome {
  if (obs.expectation === 'expect_denial') {
    if (
      (obs.response_status !== undefined && obs.response_status >= 400) ||
      obs.response_returned_rows === false
    ) {
      return 'proven_denial';
    }
    if (
      obs.response_returned_rows === true ||
      (obs.response_status !== undefined && obs.response_status < 300)
    ) {
      return 'proven_allowed'; // the access was allowed when denial was expected
    }
    return 'inconclusive';
  }
  // expect_allow
  if (
    (obs.response_status !== undefined && obs.response_status < 300) ||
    obs.response_returned_rows === true
  ) {
    return 'proven_allowed';
  }
  if (
    (obs.response_status !== undefined && obs.response_status >= 400) ||
    obs.response_returned_rows === false
  ) {
    return 'proven_denial';
  }
  return 'inconclusive';
}

/** Turn an unexpected probe outcome into a deterministic floor finding. */
export function findingForOutcome(
  obs: ProbeObservation,
  outcome: ProbeOutcome,
): Finding | undefined {
  if (outcome === 'inconclusive') {
    return {
      id: `probe-inconclusive-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'unknown',
      title: `Probe ${obs.probe_id} outcome inconclusive`,
      summary:
        'Probe response was inconclusive; needs human review. Negative tests should be added.',
      evidence_refs: [],
    };
  }
  if (obs.expectation === 'expect_denial' && outcome === 'proven_allowed') {
    // The control was expected to deny and did NOT. Likely launch-blocking.
    return {
      id: `probe-allowed-when-deny-expected-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'confirmed_issue',
      evidence_strength: 'high',
      reproducibility: 'tool_output',
      review_action: 'fix_before_launch',
      blast_radius: 'user_data',
      title: `Probe ${obs.probe_id}: access was allowed when denial was expected`,
      summary:
        'Active probe found a path that appears launch-blocking; needs human review.',
      evidence_refs: [],
    };
  }
  if (obs.expectation === 'expect_allow' && outcome === 'proven_denial') {
    // Allowed path was denied — availability issue, but not security-blocking.
    return {
      id: `probe-denied-when-allow-expected-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'tool_output',
      review_action: 'review_before_launch',
      blast_radius: 'availability',
      title: `Probe ${obs.probe_id}: expected-allowed access was denied`,
      summary:
        'Active probe found that an allowed path was blocked; needs human review.',
      evidence_refs: [],
    };
  }
  // proven_denial when expect_denial, or proven_allowed when expect_allow → no finding.
  return undefined;
}
