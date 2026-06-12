import type { z } from 'zod';

import type { AllowedAction } from './validation-policy.js';

/**
 * Probe-primitive request-schema substrate (Phase 3 / Step 39, Directive 1).
 * Each active probe declares the SHAPE of the request it will issue and
 * declares which fields the AI may parameterise vs which are FIXED. The
 * agentic loop validates the AI-proposed request against this schema BEFORE
 * the probe runs; a deterministic outcome classifier (in the floor — Step 35)
 * decides the assertion outcome AFTER. AI never invents a new executable test
 * type (preventer 9 spirit); AI authors parameters within a typed envelope.
 *
 * Step 39b extends the interface with `requiredActions`, `cleanup_strategy`,
 * and `uncertainty_notes` so 12 additional probes (cc-11-1 through
 * cc-11-13e) can declare their full capability set + cleanup discipline
 * per-control. The dynamic-gate hook on `probe-http` reads `requiredActions`
 * at policy-gate time (per primitive — derived from parsed args), so a
 * single tool descriptor can route 13 primitives without expanding the
 * policy gate's static-action shape.
 */

/** A probe field the AI may author. */
export interface AiAuthoredField {
  readonly mode: 'ai_authored';
  /** Zod schema constraining the field value (length cap, regex, etc.). */
  readonly schema: z.ZodTypeAny;
}

/** A probe field whose value is fixed in the probe primitive. */
export interface FixedField<T> {
  readonly mode: 'fixed';
  readonly value: T;
}

export type ProbeField<T> = AiAuthoredField | FixedField<T>;

/**
 * The request shape a probe will issue. `method` is typically fixed; `urlTemplate`
 * is fixed with `{name}` placeholders the AI may fill (each placeholder is one
 * `aiAuthored` field below); `bodySchema` is a Zod schema bounding the body
 * (rejects injection/pollution + caps per-field length).
 */
export interface ProbeRequestSchema {
  readonly method: FixedField<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  readonly urlTemplate: FixedField<string>;
  /** Map of `{placeholder} → field`. AI authors authored values; fixed values are checked. */
  readonly pathParams: Readonly<Record<string, ProbeField<string>>>;
  readonly bodySchema: z.ZodTypeAny;
}

/**
 * Per-primitive cleanup discipline (Step 39b Decision F). GET-only probes
 * use `audit_only` — `WriteRegistry` records the call for audit but
 * `reverseWalk` no-ops it. Mutating probes (cc-11-4 POST, cc-11-13b–e
 * synthesize fixture rows) use `reverse` — `reverseWalk` inverts each
 * write entry (DELETE on synthesized rows).
 */
export type ProbeCleanupStrategy = 'audit_only' | 'reverse';

/** One executable probe primitive. */
export interface ProbePrimitive {
  /** Stable id of the probe (e.g. `cc-11-3-direct-object-access`). */
  readonly id: string;
  /** Control id the probe contributes evidence for. */
  readonly control_id: string;
  /** Short human description (allowed-claim wording). */
  readonly title: string;
  /** Declared request shape (Verification a). */
  readonly requestSchema: ProbeRequestSchema;
  /**
   * Step 39b Decision H (codex 39b-002 + 39b-003 [APPLIED]): the FULL set of
   * `AllowedAction` capabilities this probe needs at the policy gate. The
   * `probe-http` descriptor's `requiredActionForArgs` hook derives this
   * from the parsed `args.probe_id` and enforces ALL declared actions
   * against `policy.allowed_actions`. Empty array is invalid; at minimum
   * every probe declares `'call_api_with_test_identity'`.
   */
  readonly requiredActions: readonly AllowedAction[];
  /** Step 39b Decision F: cleanup discipline per probe. */
  readonly cleanup_strategy: ProbeCleanupStrategy;
  /**
   * Step 39b Decision L: documented residual-shape limitation. Surfaces
   * in the floor's per-finding `summary` so the operator understands why
   * an `inconclusive` outcome was emitted (e.g. cc-11-13e's empty-response
   * indistinguishability between RLS-filter and no-match).
   */
  readonly uncertainty_notes?: string;
  /**
   * Step 39b codex 39b-outcome-config-not-wired [APPLIED]: optional
   * per-primitive body-shape predicate. Probe-http calls this on the
   * response body (already-redacted scalar `string`) to derive
   * `response_returned_rows`. When absent, the default detection
   * (non-empty PostgREST array = rows) applies. cc-11-1, cc-11-13b,
   * cc-11-13c, cc-11-13d, cc-11-13e use this to inspect for HTML shell /
   * declared-private columns / cross-tenant rows / embed leakage.
   *
   * The function is PURE, deterministic, and `Finding`-free; it lives in
   * `src/agents/sandbox-runner/probe-primitives/body-predicates.ts` (V9
   * enforces). It receives the response body string + the AI-authored
   * args object (after schema parse) so per-control predicates can read
   * structural args like `privateColumns` or `tenantColumn`, plus the
   * actor's tenant value (when known) for cross-tenant detection.
   */
  readonly bodyPredicate?: (
    body: string,
    args: Readonly<Record<string, unknown>>,
  ) => boolean;
}

/**
 * An AI-authored proposed request, validated against {@link ProbeRequestSchema}.
 * `path_params` is `Record<string, unknown>` per Step 39b codex
 * 39b-probe-args-structured-fields-broken [APPLIED]: per-primitive schemas
 * may declare arrays (cc-11-1 path segments) or structured objects
 * (cc-11-13c filter, cc-11-13d embed) that the compiler validates via the
 * primitive's per-field schema. The compiler's transform output is what
 * gets substituted into the URL — already URL-safe.
 */
export interface ProposedProbeRequest {
  readonly method: string;
  readonly path_params: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

/** Result of compiling an AI-proposed request against a probe primitive. */
export type CompiledProbeRequest =
  | {
      readonly ok: true;
      readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      readonly url: string;
      readonly body: unknown;
    }
  | { readonly ok: false; readonly reason: string };
