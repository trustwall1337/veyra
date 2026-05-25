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
 *
 * Note on retro-12b f1 (declared_intent + Pass-1 facts-only rule):
 * declared_intent CAN be AI-derived (after 17c). Predicates that fire
 * on declared_intent intentionally emit `coverage_gap` (evidence_strength:
 * low, review_action: add_test) — never `confirmed_issue`. This
 * satisfies constraint 10's classification-authority intent: AI never
 * sets the launch-block classification; it can only nudge a reviewer
 * (or Phase 2 active validation) toward a negative test.
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

function buildFinding(
  item: ChecklistItem,
  evidenceRefs: readonly string[],
): Finding {
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
    evidence_refs: evidenceRefs,
    suggested_test_ids: item.suggested_tests,
  };
}

interface ProjectedContext {
  readonly ctx: ChecklistContext;
  readonly tableFactIds: ReadonlyMap<string, string>;
}

/**
 * Project ScanFact[] + declared context into the shape the original
 * checklist consumes. Per retro-12b f5: table names come from the
 * structured `source.name` field of schema_element facts, not from
 * parsing `sanitized_excerpt` JSON (which is presentation text and
 * subject to redaction).
 */
function projectContext(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): ProjectedContext {
  const declaredObserved = declared?.observed_evidence;
  const tables = new Set<string>(
    declaredObserved?.supabase_schema?.tables ?? [],
  );
  // Track which schema_element fact carries each table so coverage_gap
  // findings can cite the fact_id (retro-12b f2).
  const tableFactIds = new Map<string, string>();
  for (const f of facts) {
    if (f.source.kind !== 'schema_element') continue;
    if (f.source.element_kind !== 'table') continue;
    // The structured `source.name` field is the API; payload is
    // presentation text. e.g. "public.payments" or just "payments".
    const sourceName = f.source.name;
    if (typeof sourceName !== 'string' || sourceName.length === 0) continue;
    // Strip a "schema." prefix if present so the bare table name
    // also matches checklist regexes that look for the leaf name.
    const dotIdx = sourceName.indexOf('.');
    const bareName = dotIdx >= 0 ? sourceName.slice(dotIdx + 1) : sourceName;
    tables.add(sourceName);
    tableFactIds.set(sourceName, f.fact_id);
    if (bareName !== sourceName) {
      tables.add(bareName);
      tableFactIds.set(bareName, f.fact_id);
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
    ctx: {
      observed_evidence: observed,
      ...(declared?.declared_intent !== undefined
        ? { declared_intent: declared.declared_intent }
        : {}),
    },
    tableFactIds,
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
  const { ctx, tableFactIds } = projectContext(facts, declared);
  const refs = Array.from(tableFactIds.values());
  return CHECKLIST.filter((item) => item.applies(ctx)).map((item) =>
    buildFinding(item, refs),
  );
}

// Individually exported predicates so the orchestrator can route by
// id rather than as a bundle. Each addresses the same checklist item
// directly; consumers that only care about one predicate can use the
// narrow form. Adding a new addressable predicate = appending a
// ChecklistItem entry in CHECKLIST (the registry), no edit required
// here unless the orchestrator wants a typed accessor.

function predicateForId(
  id: string,
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  const item = CHECKLIST.find((c) => c.id === id);
  if (item === undefined) return [];
  const { ctx, tableFactIds } = projectContext(facts, declared);
  if (!item.applies(ctx)) return [];
  return [buildFinding(item, Array.from(tableFactIds.values()))];
}

export function predicateSelfApproval(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  return predicateForId('business-self-approval', facts, declared);
}

export function predicateCrossTenantInvite(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  return predicateForId('business-cross-tenant-invite', facts, declared);
}

export function predicateRefundFlow(
  facts: readonly ScanFact[],
  declared?: ChecklistContext,
): readonly Finding[] {
  return predicateForId('business-refund-flow-authz', facts, declared);
}
