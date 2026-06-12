import {
  predicateAdminWithoutServerCheck,
  predicateClientOnlyProtection,
} from '../agents/authn/predicates.js';
import {
  predicateClientTenantId,
  predicateCrossTenantWriteRisk,
  predicateDirectObjectAccess,
} from '../agents/authz-tenant/predicates.js';
import { predicatesBusinessLogic } from '../agents/business-logic/predicates.js';
import {
  classifyProbe,
  type ProbeObservation,
  type ProbeOutcome,
} from '../agents/sandbox-runner/outcome-classifier.js';
import {
  predicateAllAuthenticated,
  predicateBroadPolicy,
  predicatePrivilegedClientKey,
  predicatePublicBucket,
  predicateRlsMissing,
} from '../agents/supabase-rls/predicates.js';
import type { FloorPredicate } from '../core/orchestrator/floor.js';
import type { Finding } from '../types/finding.js';
import type { ScanFact } from '../types/scan-fact.js';

/**
 * Step 35b — typed registry of per-control deterministic predicates that the
 * post-loop floor iterates. Imports every existing predicate from
 * `src/agents/{authn,authz-tenant,supabase-rls,business-logic}/predicates.ts`
 * unchanged, plus the direct-scanner-hit reconstruction below for cc-11-8 and
 * cc-11-10 (which on the topo-sort path are emitted from
 * `tool-runner.ts:560-583`'s `findingsForSection`). Adding the 13th-onwards
 * predicate is a one-line append; no central switch.
 *
 * Trust model (PLAN §D.2):
 *  - Registry entries are PURE functions of `readonly ScanFact[]` — predicates
 *    own their classification logic; the registry is a call site, not a
 *    re-implementation.
 *  - **This file lives in `src/cli/`** (NOT `src/core/`) so the
 *    `no-cross-layer-imports` invariant stays green: `src/core/` does not
 *    import from `src/agents/`. The CLI wires the registry into the loop via
 *    `RunAgenticLoopDeps.runFloor`; `src/core/orchestrator/floor.ts` exports
 *    the `FloorPredicate` type and accepts `predicates?` as an injected
 *    parameter (default empty array — the foundation contract stays
 *    agent-agnostic).
 *  - The §D.2(iii) import-graph guard re-asserts that `Finding` is unreachable
 *    from any registered tool's `invoke`. This file is NOT under any
 *    registered tool's reachable set; the floor IS reachable from the loop
 *    entry, but the loop never reaches a tool from the floor (one-way edge).
 */

/**
 * Ordered registry. Iteration order is the order findings appear in the
 * report's per-control card list (each predicate's emitter already produces
 * stable ordering). The direct-scanner-hit entry sits LAST so per-control
 * predicates (which may consume scanner facts for indirect evidence) run
 * first and so the cc-11-8 / cc-11-10 launch-blocker / likely_issue findings
 * appear after the per-control cards in the rendered report.
 */
export const FLOOR_PREDICATES: readonly FloorPredicate[] = [
  {
    predicate_id: 'authn-client-only-protection',
    control_ids: ['cc-11-1'],
    run: predicateClientOnlyProtection,
  },
  {
    predicate_id: 'authn-admin-without-server-check',
    control_ids: ['cc-11-2'],
    run: predicateAdminWithoutServerCheck,
  },
  {
    predicate_id: 'authz-direct-object-access',
    control_ids: ['cc-11-3'],
    run: predicateDirectObjectAccess,
  },
  {
    predicate_id: 'authz-client-tenant-id',
    control_ids: ['cc-11-4'],
    run: predicateClientTenantId,
  },
  {
    predicate_id: 'authz-cross-tenant-write-risk',
    control_ids: ['cc-11-3'],
    run: predicateCrossTenantWriteRisk,
  },
  {
    predicate_id: 'rls-missing',
    control_ids: ['cc-11-5'],
    run: predicateRlsMissing,
  },
  {
    predicate_id: 'rls-broad-policy',
    control_ids: ['cc-11-6'],
    run: predicateBroadPolicy,
  },
  {
    predicate_id: 'rls-all-authenticated',
    control_ids: ['cc-11-9'],
    run: predicateAllAuthenticated,
  },
  {
    predicate_id: 'rls-public-bucket',
    control_ids: ['cc-11-12'],
    run: predicatePublicBucket,
  },
  {
    predicate_id: 'rls-privileged-client-key',
    control_ids: ['cc-11-7'],
    run: predicatePrivilegedClientKey,
  },
  {
    predicate_id: 'business-logic',
    control_ids: ['cc-11-11'],
    run: predicatesBusinessLogic,
  },
  {
    // Step 40c-v3 Decision D — active-validation outcome classifier. Runs
    // `classifyProbe(...)` + `findingForOutcome(...)` over every `probe_response`
    // ScanFact (emitted by the probe-http tool). Findings emit only for
    // launch-blocker cases (expect_denial → proven_allowed = confirmed_issue;
    // expect_allow → proven_denial = likely_issue availability; inconclusive =
    // coverage_gap). `proven_denial` when denial was expected → NO finding.
    predicate_id: 'active-validation-probe-outcomes',
    // Step 39b: extended from ['cc-11-3'] (40c-v3 scope) to all 13 migrated
    // probe control_ids. The predicate body iterates probe_response ScanFacts
    // and routes per-control via `renderProbeFinding` (codex 39b-007 [APPLIED]
    // — the renderer moved here from outcome-classifier.ts so the sandbox-
    // runner stays Finding-free).
    control_ids: [
      'cc-11-1',
      'cc-11-2',
      'cc-11-3',
      'cc-11-4',
      'cc-11-6',
      'cc-11-9',
      'cc-11-12',
      'cc-11-13a',
      'cc-11-13b',
      'cc-11-13c',
      'cc-11-13d',
      'cc-11-13e',
    ],
    run: probeOutcomeFindings,
  },
  {
    predicate_id: 'direct-scanner-hit',
    control_ids: ['cc-11-8', 'cc-11-10'],
    run: directScannerHitFindings,
  },
];

/**
 * Step 40c-v3 — turn every accepted `probe_response` ScanFact into the
 * deterministic outcome finding (if any). Floor is the sole `Finding`
 * producer (§D.2); this function calls `classifyProbe` + `findingForOutcome`
 * from `outcome-classifier.ts` exactly as the topo-path sandbox-runner does.
 */
function probeOutcomeFindings(facts: readonly ScanFact[]): readonly Finding[] {
  const out: Finding[] = [];
  for (const fact of facts) {
    if (fact.source.kind !== 'probe_response') continue;
    const obs: ProbeObservation = {
      probe_id: fact.source.probe_id,
      control_id: fact.source.control_id,
      response_status: fact.source.payload.response_status,
      response_returned_rows: fact.source.payload.response_returned_rows,
      expectation: fact.source.payload.expectation,
    };
    const outcome = classifyProbe(obs);
    const finding = renderProbeFinding(obs, outcome);
    if (finding !== undefined) out.push(finding);
  }
  return out;
}

/**
 * Step 39b Decision E (codex 39b-007 [APPLIED]): renders the per-probe
 * Finding from a classified outcome. RELOCATED from
 * `src/agents/sandbox-runner/outcome-classifier.ts` so the sandbox-runner
 * stays Finding-free (V9 import-graph guard). The body is byte-equivalent
 * to the pre-relocation `findingForOutcome` so 40c-v3's cc-11-3 V13
 * cleanup-roundtrip test is unaffected (V9b regression assertion).
 *
 * MODULE-INTERNAL helper — not exported; the predicate body above is the
 * sole call site.
 */
function renderProbeFinding(
  obs: ProbeObservation,
  outcome: ProbeOutcome,
): Finding | undefined {
  if (outcome === 'inconclusive') {
    return {
      id: `probe-inconclusive-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'unknown',
      title: `Probe ${obs.probe_id} outcome inconclusive`,
      summary:
        'Probe response was inconclusive; needs human review. Negative tests should be added.',
      evidence_refs: [],
    };
  }
  if (obs.expectation === 'expect_denial' && outcome === 'proven_allowed') {
    return {
      id: `probe-allowed-when-deny-expected-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'confirmed_issue',
      evidence_strength: 'high',
      reproducibility: 'tool_output',
      review_action: 'fix_before_launch',
      blast_radius: obs.control_id === 'cc-11-2' ? 'admin_access' : 'user_data',
      title: `Probe ${obs.probe_id}: access was allowed when denial was expected`,
      summary:
        'Active probe found a path that appears launch-blocking; needs human review.',
      evidence_refs: [],
    };
  }
  if (obs.expectation === 'expect_allow' && outcome === 'proven_denial') {
    return {
      id: `probe-denied-when-allow-expected-${obs.probe_id}`,
      control_id: obs.control_id,
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'tool_output',
      review_action: 'review_before_launch',
      blast_radius: 'availability',
      title: `Probe ${obs.probe_id}: expected-allowed access was denied`,
      summary:
        'Active probe found that an allowed path was blocked; needs human review.',
      evidence_refs: [],
    };
  }
  return undefined;
}

/**
 * cc-11-8 (gitleaks: confirmed_issue, high) + cc-11-10 (OSV: likely_issue,
 * medium) — direct deterministic per-FPP §11. On the topo path this is emitted
 * by `tool-runner.ts:findingsForSection`; here it runs over the floor's
 * accepted facts so the loop produces the same launch-blocker + CVE findings.
 *
 * Per-scanner classification mirrors the canonical map at
 * `src/agents/tool-runner/tool-runner.ts:104-147`. If that map ever changes,
 * a Step 35b-style migration moves both call sites to a shared module.
 */
export function directScannerHitFindings(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const out: Finding[] = [];
  let gitleaksIdx = 0;
  let osvIdx = 0;
  for (const fact of facts) {
    if (fact.source.kind !== 'scanner_match') continue;
    const scannerName = String(fact.source.scanner_id);
    const ruleId = fact.source.payload.rule_id ?? scannerName;
    const title = fact.source.payload.sanitized_excerpt;
    const where = locationSuffix(fact);
    const evidenceRef = `${scannerName}:${ruleId}:${fact.file_path ?? '<no-file>'}:${String(fact.line ?? 0)}`;

    if (scannerName === 'gitleaks') {
      out.push({
        id: `tool-runner-gitleaks-${String(gitleaksIdx)}`,
        control_id: 'cc-11-8',
        finding_type: 'confirmed_issue',
        evidence_strength: 'high',
        reproducibility: 'tool_output',
        review_action: 'fix_before_launch',
        blast_radius: 'secrets',
        title,
        summary: `gitleaks rule ${ruleId} matched${where}; needs human review.`,
        evidence_refs: [evidenceRef],
      });
      gitleaksIdx += 1;
    } else if (scannerName === 'osv') {
      out.push({
        id: `tool-runner-osv-${String(osvIdx)}`,
        control_id: 'cc-11-10',
        finding_type: 'likely_issue',
        evidence_strength: 'medium',
        reproducibility: 'tool_output',
        review_action: 'review_before_launch',
        blast_radius: 'unknown',
        title,
        summary: `osv rule ${ruleId} matched; needs human review.`,
        evidence_refs: [evidenceRef],
      });
      osvIdx += 1;
    }
    // semgrep direct hits stay in the per-control predicate path (the
    // predicates above resolve each semgrep rule's cc-11-N target).
  }
  return out;
}

function locationSuffix(fact: ScanFact): string {
  if (fact.file_path === undefined) return '';
  return fact.line !== undefined
    ? ` at ${fact.file_path}:${String(fact.line)}`
    : ` in ${fact.file_path}`;
}
