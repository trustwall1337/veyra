/**
 * Deterministic probe outcome classifier (Phase 3 / Step 39; Step 39b
 * Decision E codex 39b-007 [APPLIED] — Finding-free).
 *
 * Joins the floor (Step 35 pattern): runs AFTER the loop, never inside.
 * The classifier inputs are facts the loop recorded (response status,
 * response body shape — all redacted via the loop-view redactor before
 * reaching here) plus the probe's intent ("expected to be denied" /
 * "expected to be allowed").
 *
 * Outputs are the three classes PLAN-v1 §D.F + the active-validation
 * rules agreed in Phase 2 step 10: `proven_denial`, `proven_allowed`,
 * `inconclusive`. Wording uses the allowed-claim vocabulary only.
 *
 * Step 39b: `findingForOutcome` REMOVED — relocated to
 * `src/cli/floor-predicates.ts` as the module-internal helper
 * `renderProbeFinding`. The sandbox-runner now imports no Finding and
 * is statically Finding-unreachable (V9 import-graph guard).
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

// findingForOutcome REMOVED in step 39b (codex 39b-007 [APPLIED]).
// The renderer is now `renderProbeFinding` (module-internal) in
// `src/cli/floor-predicates.ts`. This file imports no `Finding` type.
