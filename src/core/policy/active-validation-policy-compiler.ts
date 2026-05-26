/**
 * ActiveValidationPolicyCompiler (step 2.07c implementation).
 *
 * Deterministic gate for any `ProposedScanPlan` — regardless of producer.
 * Validates plans typed against the shared `ProposedScanPlan` schema
 * (step 2.02), drawn from the closed catalog (step 2.07), against the
 * active `ValidationPolicy`. Producer-agnostic by design: AI Security
 * Planner (2.07b) is one producer; the deterministic fallback is
 * another. The compiler's safety guarantees do not depend on the
 * producer being trustworthy.
 *
 * Distinct from `ContextPolicyEvaluator` (Phase 1 step 08c) — they share
 * zero code beyond the registry, `Result<T, E>`, and `AllowedAction`.
 *
 * Phase 1 step 02b shipped this file as a placeholder stub with opaque
 * `ProposedScanPlan` / `CompiledScanPlan` shapes; step 2.02 then
 * shipped the real types under `src/types/scan-plan.ts`; this step
 * (2.07c) replaces the stub with the real compile() implementation
 * keyed off those real types.
 */

import { ok, err, type Result } from '../../types/result.js';
import type {
  ActiveValidationCompilationError as ActiveValidationCompilationErrorShape,
  CompiledScanPlan,
  CompiledScanPlanEntry,
  ProposedScanPlan,
  ProposedScanPlanEntry,
  TargetRef,
} from '../../types/scan-plan.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';
import type { SyntheticDataPolicy } from '../../types/active-validation.js';

// Step 2.07c: the mandatory baseline lives here (src/core/policy/)
// because the compiler is the authority. The AI Security Planner
// imports it from this file; not the other way around (the
// no-cross-layer-imports test forbids src/core/ → src/agents/).
export const MANDATORY_BASELINE_CONTROL_IDS: readonly string[] = [
  'cc-11-1',
  'cc-11-2',
  'cc-11-5',
  'cc-11-9',
];

// Re-export the shared shape under the local name some callers
// historically imported. Step 02b's class-shaped error stays around
// as a wrapper for callers that want an Error instance; new callers
// should use the shape from `src/types/scan-plan.ts`.
export type { ActiveValidationCompilationErrorShape as ActiveValidationCompilationError };
export type { CompiledScanPlan, ProposedScanPlan } from '../../types/scan-plan.js';

/**
 * Class form for callers that want `Error.message` ergonomics. Step
 * 2.07c keeps both: the shape (re-exported above) is the canonical
 * compile-error contract; this class wraps it for `throw`/`cause`
 * chains.
 */
export class ActiveValidationCompilationErrorClass extends Error {
  override readonly name = 'ActiveValidationCompilationError';
  constructor(
    message: string,
    public readonly rejected_entries: readonly {
      readonly entry: ProposedScanPlanEntry;
      readonly reason: string;
    }[] = [],
    public readonly missing_baseline_controls: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Per-control-id required AllowedActions. Keyed by `control_id` (opaque
 * string) per FPP §2A — no closed union switch.
 */
export const ACTIONS_REQUIRED_BY_CONTROL: Readonly<
  Record<string, readonly AllowedAction[]>
> = {
  'cc-11-1': ['call_api_with_test_identity', 'verify_denial'],
  'cc-11-2': ['create_synthetic_user', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-3': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-4': ['create_synthetic_user', 'create_synthetic_tenant', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-5': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-6': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-9': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-12': ['call_api_with_test_identity', 'verify_denial'],
  // Step 2.07d: PostgREST query-surface checks. cc-11-13a is an
  // exposure probe (no synthetic-data needed); the rest need at
  // least one synthetic actor.
  'cc-11-13a': ['call_api_with_test_identity'],
  'cc-11-13b': ['create_synthetic_user', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-13c': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-13d': ['create_synthetic_user', 'create_synthetic_tenant', 'create_synthetic_record', 'call_api_with_test_identity', 'verify_denial'],
  'cc-11-13e': ['create_synthetic_user', 'call_api_with_test_identity', 'verify_denial'],
};

export interface CompilerInputs {
  readonly proposed: ProposedScanPlan;
  readonly policy: ValidationPolicy;
  readonly knownRoutes?: readonly string[];
  readonly knownTables?: readonly string[];
  readonly knownBuckets?: readonly string[];
  readonly syntheticDataPolicy?: SyntheticDataPolicy;
  readonly deterministicBaselineEntries?: Readonly<
    Record<string, ProposedScanPlanEntry>
  >;
}

const NO_TARGET_CONTROLS = new Set(['cc-11-1', 'cc-11-2']);

function defaultBaselineEntryFor(controlId: string): ProposedScanPlanEntry {
  return {
    test_id: `${controlId}-baseline-injected`,
    control_id: controlId,
    priority: 'medium',
    parameters: {},
    justification: `mandatory baseline injected by ActiveValidationPolicyCompiler — ${controlId} was not in the proposed plan`,
  };
}

function resolveTarget(
  entry: ProposedScanPlanEntry,
  inputs: CompilerInputs,
): { ok: true; target: TargetRef } | { ok: false; reason: string } {
  if (NO_TARGET_CONTROLS.has(entry.control_id)) {
    return { ok: true, target: { kind: 'http_surface', ref: '*' } };
  }
  const param = entry.parameters['target'];
  if (typeof param === 'object' && param !== null) {
    const t = param as Record<string, unknown>;
    const kind = typeof t['kind'] === 'string' ? (t['kind'] as string) : 'unknown';
    const ref = typeof t['ref'] === 'string' ? (t['ref'] as string) : '';
    if (kind === 'table') {
      const known = new Set(inputs.knownTables ?? []);
      if (!known.has(ref)) {
        return { ok: false, reason: `target table "${ref}" not in known schema` };
      }
      return { ok: true, target: { kind, ref } };
    }
    if (kind === 'bucket') {
      const known = new Set(inputs.knownBuckets ?? []);
      if (!known.has(ref)) {
        return { ok: false, reason: `target bucket "${ref}" not in known storage` };
      }
      return { ok: true, target: { kind, ref } };
    }
    if (kind === 'route') {
      const known = new Set(inputs.knownRoutes ?? []);
      if (!known.has(ref)) {
        return { ok: false, reason: `target route "${ref}" not in inventory` };
      }
      return { ok: true, target: { kind, ref } };
    }
    // Codex retro 2.07c-unknown-target-kind-accepted: reject any
    // target.kind outside the closed compiler-supported set
    // (table | bucket | route). New kinds register intentionally
    // here; they do not fall through as ok.
    return {
      ok: false,
      reason: `target.kind "${kind}" is not one of the compiler-supported kinds (table | bucket | route)`,
    };
  }
  return {
    ok: false,
    reason: `entry control_id "${entry.control_id}" requires parameters.target { kind, ref }`,
  };
}

export function compile(
  inputs: CompilerInputs,
): Result<CompiledScanPlan, ActiveValidationCompilationErrorShape> {
  const { proposed, policy } = inputs;
  const allowed = policy.allowed_actions;
  const rejected: { entry: ProposedScanPlanEntry; reason: string }[] = [];
  const compiledEntries: CompiledScanPlanEntry[] = [];
  let identityBudget = inputs.syntheticDataPolicy?.max_identities ?? Infinity;
  let tenantBudget = inputs.syntheticDataPolicy?.max_tenants ?? Infinity;
  let recordBudget = inputs.syntheticDataPolicy?.max_records ?? Infinity;

  for (const entry of proposed.entries) {
    const requiredActions = ACTIONS_REQUIRED_BY_CONTROL[entry.control_id];
    if (requiredActions === undefined) {
      rejected.push({
        entry,
        reason: `control_id "${entry.control_id}" not in compiler's ACTIONS_REQUIRED_BY_CONTROL map`,
      });
      continue;
    }
    const missing = requiredActions.filter((a) => !allowed.has(a));
    if (missing.length > 0) {
      rejected.push({
        entry,
        reason: `policy denies required actions: ${missing.join(', ')}`,
      });
      continue;
    }
    const tgt = resolveTarget(entry, inputs);
    if (!tgt.ok) {
      rejected.push({ entry, reason: tgt.reason });
      continue;
    }
    if (requiredActions.includes('create_synthetic_user')) {
      if (identityBudget < 1) {
        rejected.push({
          entry,
          reason: `synthetic-data identity budget exhausted (max_identities=${String(inputs.syntheticDataPolicy?.max_identities)})`,
        });
        continue;
      }
      identityBudget -= 1;
    }
    if (requiredActions.includes('create_synthetic_tenant')) {
      if (tenantBudget < 1) {
        rejected.push({
          entry,
          reason: `synthetic-data tenant budget exhausted (max_tenants=${String(inputs.syntheticDataPolicy?.max_tenants)})`,
        });
        continue;
      }
      tenantBudget -= 1;
    }
    if (requiredActions.includes('create_synthetic_record')) {
      if (recordBudget < 1) {
        rejected.push({
          entry,
          reason: `synthetic-data record budget exhausted (max_records=${String(inputs.syntheticDataPolicy?.max_records)})`,
        });
        continue;
      }
      recordBudget -= 1;
    }
    compiledEntries.push({
      ...entry,
      validated_target_ref: tgt.target,
      allowed_actions_satisfied: requiredActions,
    });
  }

  // Step 2.07c rejection contract: ANY explicit entry rejection (wrong
  // action, unknown target, budget exceeded) → err. Only the
  // missing-baseline path is "soft" (the compiler injects from the
  // deterministic fallback). The step file's wording: "Compile-rejects-
  // unknown-target test ... → rejected" treats the bad-entry case as
  // a hard error.
  // Codex retro 2.07c-mandatory-baseline-can-disappear: if a
  // mandatory baseline cannot be injected (action not allowed,
  // target not resolvable, budget exhausted), the compiler used to
  // silently skip it and still return ok. That violates constraint 6
  // (compiler is the floor; the baseline NEVER disappears). Now the
  // compiler accumulates baseline-injection failures and routes to
  // err with a structured reason naming the missing control and the
  // failed prerequisite.
  const presentControls = new Set(compiledEntries.map((e) => e.control_id));
  const missingBaselines: string[] = [];
  const baselineInjections: string[] = [];
  const baselineFailures: { entry: ProposedScanPlanEntry; reason: string }[] = [];
  if (rejected.length === 0) {
    for (const baseline of MANDATORY_BASELINE_CONTROL_IDS) {
      if (presentControls.has(baseline)) continue;
      missingBaselines.push(baseline);
      const fallback =
        inputs.deterministicBaselineEntries?.[baseline] ??
        defaultBaselineEntryFor(baseline);
      const requiredActions = ACTIONS_REQUIRED_BY_CONTROL[baseline] ?? [];
      const missing = requiredActions.filter((a) => !allowed.has(a));
      if (missing.length > 0) {
        baselineFailures.push({
          entry: fallback,
          reason: `mandatory baseline control_id "${baseline}" cannot run: policy denies actions ${missing.join(', ')}`,
        });
        continue;
      }
      const tgt = resolveTarget(fallback, inputs);
      if (!tgt.ok) {
        baselineFailures.push({
          entry: fallback,
          reason: `mandatory baseline control_id "${baseline}" cannot run: ${tgt.reason}`,
        });
        continue;
      }
      // Budget check on baseline injection — baselines respect the
      // same per-scan caps as AI-proposed entries.
      if (requiredActions.includes('create_synthetic_user')) {
        if (identityBudget < 1) {
          baselineFailures.push({
            entry: fallback,
            reason: `mandatory baseline control_id "${baseline}" cannot run: identity budget exhausted`,
          });
          continue;
        }
        identityBudget -= 1;
      }
      if (requiredActions.includes('create_synthetic_tenant')) {
        if (tenantBudget < 1) {
          baselineFailures.push({
            entry: fallback,
            reason: `mandatory baseline control_id "${baseline}" cannot run: tenant budget exhausted`,
          });
          continue;
        }
        tenantBudget -= 1;
      }
      if (requiredActions.includes('create_synthetic_record')) {
        if (recordBudget < 1) {
          baselineFailures.push({
            entry: fallback,
            reason: `mandatory baseline control_id "${baseline}" cannot run: record budget exhausted`,
          });
          continue;
        }
        recordBudget -= 1;
      }
      compiledEntries.push({
        ...fallback,
        validated_target_ref: tgt.target,
        allowed_actions_satisfied: requiredActions,
      });
      baselineInjections.push(fallback.test_id);
    }
  }

  if (rejected.length > 0 || baselineFailures.length > 0) {
    return err({
      rejected_entries: [...rejected, ...baselineFailures],
      missing_baseline_controls: missingBaselines,
    });
  }

  const compiled: CompiledScanPlan = {
    scan_id: proposed.scan_id,
    source_producer_id: proposed.producer_id,
    entries: compiledEntries,
    compiled_at: new Date().toISOString(),
    baseline_injections: baselineInjections,
  };
  return ok(compiled);
}
