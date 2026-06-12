import type { Finding } from '../../types/finding.js';
import type { ScanFact } from '../../types/scan-fact.js';
import type { NamedFact } from '../../types/tool-result.js';

import {
  namedFactsToScanFacts,
} from './named-fact-to-scan-fact.js';
import type { LedgerGap } from './required-evidence-ledger.js';

/**
 * The deterministic floor (Phase 3 / Agentic Veyra, Step 35 + Step 35b,
 * PLAN §B + §D.2). SOLE Finding producer; SOLE classification site. Reads
 * ONLY parsed-accepted facts (the loop has already enforced the
 * result-parse-or-reject boundary) and the §K ledger gaps. The AI never
 * reaches this code: the import-graph walk in
 * `import-graph-finding-guard.test.ts` proves that `Finding` is unreachable
 * from any registered tool's `invoke`.
 *
 * Step 35b: the floor accepts an injected `predicates` registry — the concrete
 * registry lives in `src/cli/floor-predicates.ts` so this file stays
 * import-clean (`no-cross-layer-imports` invariant: `src/core/` does not
 * import from `src/agents/`). The floor bridges the loop's `NamedFact[]` back
 * to `ScanFact[]`, iterates the injected predicate registry, then appends the
 * ledger `coverage_gap`s. Bridge decode failure becomes a single internal
 * `coverage_gap` (control id `cc-11-internal-fact-decode`) — never throws, so
 * the §D.1 invariant "floor always runs" stays.
 */

/**
 * One predicate registry entry. The CLI wires the concrete registry array;
 * `floor.ts` consumes only this type.
 */
export interface FloorPredicate {
  readonly predicate_id: string;
  readonly control_ids: readonly string[];
  readonly run: (facts: readonly ScanFact[]) => readonly Finding[];
}

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
 * Step 35b — synthetic finding when the loop's `NamedFact[]` does not decode
 * back to `ScanFact[]`. Indicates a bug (one of the registered tools is
 * emitting a fact shape `scanFactsToToolResult` doesn't produce), not a
 * project issue. The floor still runs the ledger-gap step so we never lose
 * coverage information on the way out.
 */
function bridgeDecodeFailureFinding(reason: string): Finding {
  return {
    id: 'coverage-gap-internal-fact-decode',
    control_id: 'cc-11-internal-fact-decode',
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: 'Internal: scan-fact bridge decode failed',
    summary: `Floor could not decode accepted facts back to ScanFact: ${reason}. This is a Veyra-internal issue, not an application finding; needs human review.`,
    evidence_refs: [],
  };
}

/**
 * Run the deterministic floor classification predicates. Inputs are
 * loop-accepted `facts`, ledger `gaps`, and optionally a registry of
 * per-control `predicates`. Output is a stable array of Findings — never
 * depends on AI text, never reads raw invoke output, always deterministic for
 * the same input.
 *
 * Default `predicates` is the empty array — preserves the Step-35-minimum
 * contract for callers that don't inject a registry (the CLI wires the real
 * one for both `--no-ai` and the Bedrock loop path).
 */
export function runClassificationPredicates(
  facts: readonly NamedFact[],
  gaps: readonly LedgerGap[],
  predicates: readonly FloorPredicate[] = [],
): readonly Finding[] {
  const out: Finding[] = [];

  // Step 35b: bridge loop-shape facts back to ScanFact[] so per-control
  // predicates can dispatch on `source.scanner_id` + `source.payload.rule_id`.
  const decoded = namedFactsToScanFacts(facts);
  if (!decoded.ok) {
    out.push(bridgeDecodeFailureFinding(decoded.error.message));
  } else {
    for (const predicate of predicates) {
      const findings = predicate.run(decoded.value);
      for (const f of findings) out.push(f);
    }
  }

  // Ledger gaps are appended last — they are always-on coverage information
  // regardless of how predicate evaluation went.
  for (const gap of gaps) out.push(coverageGapForLedger(gap));
  return out;
}
