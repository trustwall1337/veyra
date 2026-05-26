/**
 * Phase 2 active-validation types (step 2.02).
 *
 * Foundation for every later Phase 2 step. Pure shapes — no runtime
 * implementation in this file; no imports from `src/agents/`,
 * `src/connectors/`, or `src/scanners/` (per the
 * no-cross-layer-imports test).
 *
 * Per CLAUDE.md §Extensibility-first and FPP §2A: no hardcoded
 * provider names in shared types. Step 2.02 codex review flagged the
 * step file's literal `supabase_user_id` field name as a §2A
 * violation; renamed to `provider_subject_id` paired with an opaque
 * `identity_provider_id: ConnectorId`.
 */

import type { AnalyzerId, ConnectorId } from './identity.js';

// Phase 1's `Finding.control_id` is a bare `string` today (no
// branded type). When a `ControlId` brand lands in a later step,
// this alias becomes the brand; until then it's `string`.
export type ControlIdString = string;

/**
 * A synthetic test identity Veyra creates inside the sandbox to drive
 * active-validation tests. Per FPP §11 and PHASE_2_PLAN §5.1: identities
 * are namespace-prefixed and lifecycle-managed by the synthetic-data
 * manager (step 2.06).
 */
export interface TestIdentity {
  readonly id: string;
  readonly scan_id: string;
  /**
   * The subject identifier issued by the customer's identity provider
   * (e.g. Supabase Auth, Firebase Auth, Clerk). Opaque string; the
   * meaning is owned by `identity_provider_id`'s connector. Step 2.02
   * codex review: this replaces the step file's literal
   * `supabase_user_id` to satisfy FPP §2A.
   */
  readonly provider_subject_id: string;
  /** Opaque ConnectorId identifying which IdP issued the subject id. */
  readonly identity_provider_id: ConnectorId;
  readonly role: string;
  readonly tenant_id?: string;
  readonly created_at: string;
}

/**
 * A synthetic tenant Veyra creates so tenant-isolation negative tests
 * have somewhere to land. `owner_test_identity_id` references a
 * `TestIdentity.id`.
 */
export interface TestTenant {
  readonly id: string;
  readonly scan_id: string;
  readonly name: string;
  readonly owner_test_identity_id: string;
  readonly created_at: string;
}

/**
 * A synthetic record (e.g. a row Veyra inserted in a test table) that
 * a negative test reads, writes, or attempts to access without the
 * right privileges. `row_data_fingerprint` is a content-addressed
 * hash of the inserted data so the cleanup pass can verify removal.
 */
export interface TestRecord {
  readonly id: string;
  readonly scan_id: string;
  readonly table: string;
  readonly row_data_fingerprint: string;
  readonly created_at: string;
}

/**
 * Limits on how much synthetic data a single scan may create. Enforced
 * by the synthetic-data manager BEFORE any creation call; the
 * sandbox executor refuses requests that would exceed these caps.
 */
export interface SyntheticDataPolicy {
  /** All synthetic identities/tenants get names starting with this prefix. */
  readonly namespace_prefix: string;
  readonly max_identities: number;
  readonly max_tenants: number;
  readonly max_records: number;
  /** Maximum scan lifetime in seconds before mandatory cleanup. */
  readonly max_lifetime_seconds: number;
}

/**
 * How Veyra removes synthetic data after a scan finishes. Per PHASE_2_PLAN:
 *  - `hard_delete`: row is deleted via the provider's delete path.
 *  - `soft_with_purge`: row is soft-deleted then permanently purged.
 *
 * `verify_residual_count` is always true — cleanup is verified by
 * counting matching rows after the deletion pass. `on_cleanup_failure`
 * is locked to `'fail_scan'` — a scan that cannot prove cleanup
 * surfaces as a failure, never a pass.
 */
export interface CleanupPolicy {
  readonly strategy: 'hard_delete' | 'soft_with_purge';
  readonly verify_residual_count: true;
  readonly on_cleanup_failure: 'fail_scan';
}

/**
 * Outcome of running one negative test against the sandbox.
 *
 *  - `proven_denial`: the test confirms the system refused the
 *    unauthorized action (the desired outcome).
 *  - `proven_allowed`: the test discovered the system permitted an
 *    unauthorized action (a finding).
 *  - `inconclusive`: the test could not produce a clear signal
 *    (timeout, unexpected error, missing prerequisite).
 *
 * The literal union is closed — new outcomes require a typed
 * extension recorded in `phases/phase-2/decisions.md`, not an open
 * string.
 */
export interface ActiveValidationResult {
  readonly test_id: string;
  readonly control_id: ControlIdString;
  readonly outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
  readonly evidence_refs: readonly string[];
  readonly duration_ms: number;
  readonly synthetic_data_refs: readonly string[];
  /**
   * Structured details for renderer / explainer. Shape is up to the
   * test type; the explainer agent (step 2.09) reads it.
   */
  readonly assertion_details: Readonly<Record<string, unknown>>;
}

/**
 * One entry in an AI- or deterministically-produced negative-test plan.
 * The plan is the input to the `ActiveValidationPolicyCompiler` (step
 * 2.07c) which validates each entry against the catalog + policy and
 * emits a `CompiledScanPlan`.
 *
 * `required_synthetic_resources` lists the kinds of synthetic data this
 * entry needs ('identity', 'tenant', 'record'); the synthetic-data
 * manager pre-creates them.
 */
export interface TestPlanEntry {
  readonly test_id: string;
  readonly control_id: ControlIdString;
  /** Opaque AnalyzerId of the agent that owns this test type. */
  readonly owning_agent_id: AnalyzerId;
  readonly required_synthetic_resources: readonly (
    | 'identity'
    | 'tenant'
    | 'record'
  )[];
  /**
   * Hint about which `outcome` the planner expects. Used by the
   * explainer to highlight mismatches, never to gate the result.
   */
  readonly expected_outcome_hint?: 'proven_denial' | 'proven_allowed';
  readonly max_duration_ms: number;
}
