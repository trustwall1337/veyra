import type { Finding } from '../../types/finding.js';
import type { NamedFact } from '../../types/tool-result.js';

import type { LedgerGap } from './required-evidence-ledger.js';

/**
 * The deterministic floor (Phase 3 / Agentic Veyra, Step 35, PLAN §B + §D.2).
 * SOLE Finding producer; SOLE classification site. Reads ONLY parsed-accepted
 * facts (the loop has already enforced the result-parse-or-reject boundary)
 * and the §K ledger gaps. The AI never reaches this code: the import-graph
 * walk in `import-graph-finding-guard.test.ts` proves that `Finding` is
 * unreachable from any registered tool's `invoke`.
 *
 * Step 35 lands the ledger→coverage_gap mapping and the wiring that makes the
 * floor the default for both the agentic loop and the `--no-ai` plan-walker.
 * Relocation of the per-agent classification predicates
 * (`supabase-rls/predicates.ts`, etc.) follows the SAME pattern: each
 * predicate becomes a fact-only read in Step 33 plus a deterministic
 * classifier here. Predicates over `facts` are added incrementally without
 * changing this signature.
 */

/** One Finding per unsatisfied ledger row — the deterministic coverage gap. */
function coverageGapForLedger(gap: LedgerGap): Finding {
  return {
    id: `coverage-gap-${gap.baseline_item_id}`,
    control_id: gap.gap_control_id,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: `Required evidence missing: ${gap.baseline_item_id}`,
    summary: `Baseline item "${gap.baseline_item_id}" was not satisfied; needs human review.`,
    evidence_refs: [],
  };
}

/**
 * Run the deterministic floor classification predicates. Inputs are
 * loop-accepted `facts` and ledger `gaps`. Output is a stable array of
 * Findings — never depends on AI text, never reads raw invoke output, always
 * deterministic for the same input.
 */
export function runClassificationPredicates(
  _facts: readonly NamedFact[],
  gaps: readonly LedgerGap[],
): readonly Finding[] {
  // Phase-3 minimum: one `coverage_gap` per unsatisfied ledger row. Predicates
  // over facts (RLS shape, IDOR, secrets posture, etc.) land here as separate
  // pure functions over the `facts` argument in follow-up steps.
  return gaps.map(coverageGapForLedger);
}
