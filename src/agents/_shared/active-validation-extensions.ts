/**
 * Shared helpers for Phase 2 step 2.10a-e: extend Phase-1 agents for
 * active validation. Each Phase 1 agent (supabase-rls, authz-tenant,
 * authn, business-logic) emits `TestPlanEntry[]` for the controls it
 * owns; the orchestrator (step 2.14) collects these and hands them to
 * the AI Security Planner (or deterministic fallback) which compiles
 * them via 2.07c.
 *
 * Step 2.10e (evidence-report) reads back `active-validation-results.json`
 * and promotes corroborated findings per §5.2.
 */

import type { TestPlanEntry } from '../../types/active-validation.js';
import type { ActiveValidationResult } from '../../types/scan-plan.js';
import { asAnalyzerId, type AnalyzerId } from '../../types/identity.js';

/**
 * Build a TestPlanEntry with the canonical shape. Per FPP §2A,
 * `owning_agent_id` is an opaque AnalyzerId; the catalog drives the
 * actual test execution.
 */
export function buildTestPlanEntry(args: {
  readonly testId: string;
  readonly controlId: string;
  readonly owningAgentId: string;
  readonly requiredResources?: readonly ('identity' | 'tenant' | 'record')[];
  readonly expectedOutcomeHint?: 'proven_denial' | 'proven_allowed';
  readonly maxDurationMs?: number;
}): TestPlanEntry {
  const r = asAnalyzerId(args.owningAgentId);
  if (!r.ok) throw r.error;
  const id: AnalyzerId = r.value;
  return {
    test_id: args.testId,
    control_id: args.controlId,
    owning_agent_id: id,
    required_synthetic_resources: args.requiredResources ?? ['identity'],
    ...(args.expectedOutcomeHint !== undefined
      ? { expected_outcome_hint: args.expectedOutcomeHint }
      : {}),
    max_duration_ms: args.maxDurationMs ?? 30_000,
  };
}

/**
 * Read active-validation-results.json and index by control_id for
 * corroboration. Step 2.10e's evidence-report agent consumes this.
 */
export interface IndexedResults {
  readonly byControlId: ReadonlyMap<string, readonly ActiveValidationResult[]>;
  readonly all: readonly ActiveValidationResult[];
}

export function indexResults(
  raw: unknown,
): IndexedResults {
  const all: ActiveValidationResult[] = [];
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    const arr = r['results'];
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === 'object' && it !== null) {
          all.push(it as ActiveValidationResult);
        }
      }
    }
  }
  const m = new Map<string, ActiveValidationResult[]>();
  for (const r of all) {
    const list = m.get(r.control_id) ?? [];
    list.push(r);
    m.set(r.control_id, list);
  }
  return { byControlId: m, all };
}

/**
 * Promotion rule per §5.2: a Phase 1 `likely_issue` becomes
 * `confirmed_issue` when active validation returns `proven_allowed`
 * for the same control_id. A `coverage_gap` becomes
 * `confirmed_issue` when active validation returns `proven_allowed`.
 * Anything else stays as-is.
 *
 * Returns the promoted finding_type AND a marker that promotion
 * happened, so step 2.10e's reporter can render the promotion source.
 */
export function promoteFindingType(
  current: 'coverage_gap' | 'likely_issue' | 'confirmed_issue' | 'missing_evidence',
  results: readonly ActiveValidationResult[],
): {
  readonly newType: 'coverage_gap' | 'likely_issue' | 'confirmed_issue' | 'missing_evidence';
  readonly promotedBy?: string;
} {
  const hasProvenAllowed = results.some((r) => r.outcome === 'proven_allowed');
  const hasProvenDenial = results.some((r) => r.outcome === 'proven_denial');
  if (hasProvenAllowed && (current === 'likely_issue' || current === 'coverage_gap')) {
    return { newType: 'confirmed_issue', promotedBy: 'proven_allowed' };
  }
  // Proven denial corroborates that the control is in place; the
  // existing finding type stays (a coverage_gap could become
  // missing_evidence → still "needs human review," not "fix now").
  if (hasProvenDenial) {
    return { newType: current };
  }
  return { newType: current };
}
