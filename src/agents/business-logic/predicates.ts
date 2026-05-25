/**
 * Pass-1 assertion predicates for the business-logic agent.
 *
 * Per revision §10 step 12 row + §4.1: each predicate is a pure
 * function of (ScanFact[] | declared-context). The fixed checklist
 * from step 12 becomes the predicate set; AI's business-logic
 * concerns attach via Pass-2 (18b), never through this module.
 *
 * Predicates accept readonly ScanFact[] only; type-level absence of
 * Hypothesis input enforces constraint 10.
 */

import type {
  DeclaredIntent,
  ObservedEvidence,
} from '../../types/declared-context.js';
import type { Finding } from '../../types/finding.js';
import type { ScanFact } from '../../types/scan-fact.js';

import { CHECKLIST, type ChecklistContext, type ChecklistItem } from './checklist.js';

const UNCERTAINTY_NOTE =
  'deterministic checklist over declared context; lack of declared signal does not imply absence — these are negative-test suggestions';

function buildFinding(item: ChecklistItem): Finding {
  return {
    id: `${item.id}-coverage-gap`,
    control_id: item.control_id,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'add_test',
    blast_radius: 'tenant_data',
    title: `Business-logic check: ${item.title}`,
    summary: `${item.rationale} Negative tests should be added. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
    suggested_test_ids: item.suggested_tests,
  };
}

/**
 * Project ScanFact[] + declared context into the shape the original
 * checklist consumes. Scan-facts that carry declared-context-style
 * payloads can extend `observed_evidence` here in the future.
 */
function projectContext(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): ChecklistContext {
  const declaredObserved = declared?.observed_evidence;
  const tables = new Set<string>(
    declaredObserved?.supabase_schema?.tables ?? [],
  );
  for (const f of facts) {
    if (f.source.kind !== 'schema_element') continue;
    if (f.source.element_kind !== 'table') continue;
    try {
      const payload = JSON.parse(
        f.source.payload?.sanitized_excerpt ?? '{}',
      ) as { name?: string };
      if (typeof payload.name === 'string') tables.add(payload.name);
    } catch {
      // ignore
    }
  }
  const observed: Partial<ObservedEvidence> = {
    ...(declaredObserved ?? {}),
    ...(tables.size > 0
      ? {
          supabase_schema: {
            tables: Array.from(tables).sort(),
            schema_present:
              declaredObserved?.supabase_schema?.schema_present ?? true,
          },
        }
      : {}),
  };
  return {
    observed_evidence: observed,
    ...(declared?.declared_intent !== undefined
      ? { declared_intent: declared.declared_intent }
      : {}),
  };
}

/**
 * Pass-1 entry point. Accepts only ScanFact[] + optional declared
 * context. Returns coverage_gap findings per applicable checklist
 * item. Never returns confirmed_issue.
 */
export function predicatesBusinessLogic(
  facts: readonly ScanFact[],
  declared?: {
    readonly observed_evidence?: Partial<ObservedEvidence>;
    readonly declared_intent?: DeclaredIntent;
  },
): readonly Finding[] {
  const ctx = projectContext(facts, declared);
  return CHECKLIST.filter((item) => item.applies(ctx)).map(buildFinding);
}

// Individually exported predicates so the orchestrator can route by
// id rather than as a bundle. Each addresses the same checklist item
// directly; consumers that only care about one predicate can use the
// narrow form.

export function predicateSelfApproval(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  const item = CHECKLIST.find((c) => c.id === 'bl-self-approval');
  if (item === undefined) return [];
  const ctx = projectContext(facts, declared);
  return item.applies(ctx) ? [buildFinding(item)] : [];
}

export function predicateCrossTenantInvite(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  const item = CHECKLIST.find((c) => c.id === 'bl-cross-tenant-invite');
  if (item === undefined) return [];
  const ctx = projectContext(facts, declared);
  return item.applies(ctx) ? [buildFinding(item)] : [];
}

export function predicateRefundFlow(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  const item = CHECKLIST.find((c) => c.id === 'bl-refund-reversal');
  if (item === undefined) return [];
  const ctx = projectContext(facts, declared);
  return item.applies(ctx) ? [buildFinding(item)] : [];
}
