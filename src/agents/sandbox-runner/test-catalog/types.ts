/**
 * Negative-test catalog shared types (step 2.07).
 *
 * Each catalog file exports:
 *   - `controlId`: the canonical `cc-11-N` id (drift-guard authority).
 *   - `run(input)`: pure function over the response (network IS the
 *     only IO; outcome is fully determined by HTTP shape).
 *   - `expected_outcomes_on_fixture`: what the recorded fixture
 *     should yield for the drift-guard tests.
 *
 * Discipline (PHASE_2_PLAN §12 false-positive control):
 *   `proven_allowed` requires a SPECIFIC assertion (row.tenant_id !=
 *   actor.tenant_id, response body row count > 0, etc.). Vague
 *   responses route to `inconclusive`, not `proven_allowed`.
 */

import type {
  ActiveValidationResult,
  TestIdentity,
} from '../../../types/active-validation.js';

export interface NegativeTestInput {
  /** The synthetic identity (or operator-declared actor) running the test. */
  readonly actor: TestIdentity;
  /** The HTTP target. */
  readonly target: {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly url: string;
    readonly body?: Readonly<Record<string, unknown>>;
    readonly headers?: Readonly<Record<string, string>>;
  };
  /** The synthetic data the actor is meant to "own" (for ownership-mismatch tests). */
  readonly ownsResourceIds?: readonly string[];
  /** Optional partner-tenant resource ids (for cross-tenant tests). */
  readonly partnerResourceIds?: readonly string[];
  /** Already-resolved JWT for the actor. */
  readonly accessToken: string;
  /**
   * HTTP transport. Tests inject a fake; production uses a thin
   * wrapper around `fetch` (lands with the sandbox-runner in step
   * 2.08). The transport returns a structured response so the
   * catalog stays IO-shape-agnostic.
   */
  readonly transport: HttpTransport;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed body if Content-Type is application/json; raw string otherwise. */
  readonly body: unknown;
  /** Byte length of the body before parsing (informational). */
  readonly bodyByteLength: number;
}

export interface HttpTransport {
  send(req: NegativeTestInput['target'] & { accessToken: string }): Promise<HttpResponse>;
}

/** Drift-guard authority — every catalog file exports one of these. */
export type FixtureOutcomeSpec =
  | 'proven_denial'
  | 'proven_allowed'
  | 'inconclusive'
  | readonly { readonly variant_id: string; readonly outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' }[];

export interface CatalogEntry {
  readonly controlId: string;
  readonly description: string;
  run(input: NegativeTestInput): Promise<ActiveValidationResult>;
  readonly expected_outcomes_on_fixture: FixtureOutcomeSpec;
}

/**
 * Build an ActiveValidationResult helper used by every catalog entry.
 * Captures the common shape — duration, evidence_refs, assertion_details.
 */
export function buildResult(args: {
  readonly test_id: string;
  readonly control_id: string;
  readonly outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
  readonly started_at: number;
  readonly actor: TestIdentity;
  readonly response: HttpResponse;
  readonly assertion_details: Readonly<Record<string, unknown>>;
}): ActiveValidationResult {
  return {
    test_id: args.test_id,
    control_id: args.control_id,
    outcome: args.outcome,
    evidence_refs: [],
    duration_ms: Date.now() - args.started_at,
    synthetic_data_refs: [args.actor.id],
    assertion_details: {
      ...args.assertion_details,
      response_status: args.response.status,
      response_byte_length: args.response.bodyByteLength,
    },
  };
}
