/**
 * Codex retro 2.10-readiness-rules-missing: §5.2 + §5.3 readiness
 * rules. The evidence-report agent calls these helpers to upgrade
 * classifications based on active-validation outcomes.
 *
 * Rules implemented:
 *  - `proven_in_sandbox`: a `likely_issue` or `coverage_gap` paired
 *    with an active-validation `proven_allowed` for the same
 *    control_id promotes to `confirmed_issue + fix_before_launch`.
 *  - `cleanup_proof_gating`: a scan with `residual_count > 0` in
 *    `cleanup-proof.json` produces a `confirmed_issue +
 *    fix_before_launch` on `cc-2-06` regardless of other findings.
 *  - `scenario_coverage`: when a control declares
 *    `required_scenario_set`, every scenario must have a result
 *    (proven_*); missing scenarios surface as `coverage_gap` with
 *    a scenario-specific reason.
 *  - `--fail-on-blocker`: callers consume `shouldFailOnBlocker()`
 *    to compute the CLI exit code; the agent does not own the
 *    exit-code policy.
 */

import type {
  ActiveValidationResult,
} from '../../types/scan-plan.js';
import type { Finding } from '../../types/finding.js';
import type { CleanupProof } from '../synthetic-data-manager/agent.js';

export interface ReadinessRuleInputs {
  readonly findings: readonly Finding[];
  readonly activeResults?: readonly ActiveValidationResult[];
  readonly cleanupProof?: CleanupProof;
  readonly requiredScenariosByControlId?: ReadonlyMap<string, readonly string[]>;
}

export interface ReadinessRuleOutput {
  readonly updatedFindings: readonly Finding[];
  readonly residualBlocker?: Finding;
  readonly scenarioGaps: readonly Finding[];
}

export function applyReadinessRules(
  inputs: ReadinessRuleInputs,
): ReadinessRuleOutput {
  const resultsByControl = new Map<string, ActiveValidationResult[]>();
  for (const r of inputs.activeResults ?? []) {
    const list = resultsByControl.get(r.control_id) ?? [];
    list.push(r);
    resultsByControl.set(r.control_id, list);
  }

  // Rule 1: proven_in_sandbox promotion.
  const updated: Finding[] = inputs.findings.map((f) => {
    const results = resultsByControl.get(f.control_id) ?? [];
    const hasProvenAllowed = results.some((r) => r.outcome === 'proven_allowed');
    if (hasProvenAllowed && (f.finding_type === 'likely_issue' || f.finding_type === 'coverage_gap')) {
      return {
        ...f,
        finding_type: 'confirmed_issue' as const,
        evidence_strength: 'high' as const,
        review_action: 'fix_before_launch' as const,
        title: `${f.title} (corroborated by active validation: proven_allowed)`,
      };
    }
    return f;
  });

  // Rule 2: cleanup-proof residual blocker.
  let residualBlocker: Finding | undefined;
  if (inputs.cleanupProof !== undefined && inputs.cleanupProof.residual_count > 0) {
    residualBlocker = {
      id: 'cc-2-06-residual-cleanup-blocker',
      control_id: 'cc-2-06',
      finding_type: 'confirmed_issue',
      evidence_strength: 'high',
      reproducibility: 'mcp_context',
      review_action: 'fix_before_launch',
      blast_radius: 'tenant_data',
      title: 'Veyra-created synthetic data remained after cleanup retries',
      summary: `${String(inputs.cleanupProof.residual_count)} synthetic user(s) remained after cleanup retries. Needs human review; the Supabase project must be manually cleaned before another scan can proceed.`,
      evidence_refs: [],
    };
  }

  // Rule 3: scenario coverage.
  const scenarioGaps: Finding[] = [];
  for (const [controlId, requiredScenarios] of inputs.requiredScenariosByControlId ?? new Map()) {
    const results = resultsByControl.get(controlId) ?? [];
    const presentScenarios = new Set(
      results
        .map((r) => (r.assertion_details as Record<string, unknown> | undefined)?.['variant_id'])
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const scenario of requiredScenarios) {
      if (!presentScenarios.has(scenario)) {
        scenarioGaps.push({
          id: `${controlId}-scenario-gap-${scenario}`,
          control_id: controlId,
          finding_type: 'coverage_gap',
          evidence_strength: 'low',
          reproducibility: 'manual_review_required',
          review_action: 'review_before_launch',
          blast_radius: 'unknown',
          title: `${controlId} variant "${scenario}" was not exercised`,
          summary: `Control ${controlId} declares variant "${scenario}" in required_scenario_set; no active-validation result was observed. Negative tests should be added.`,
          evidence_refs: [],
        });
      }
    }
  }

  return {
    updatedFindings: updated,
    ...(residualBlocker !== undefined ? { residualBlocker } : {}),
    scenarioGaps,
  };
}

/**
 * `--fail-on-blocker` policy: return true when any finding is
 * confirmed_issue + fix_before_launch, OR when residual_count > 0,
 * OR when any required scenario is missing. Callers compute the
 * CLI exit code from this boolean.
 */
export function shouldFailOnBlocker(
  inputs: ReadinessRuleInputs,
  output: ReadinessRuleOutput,
): boolean {
  const hasBlocker = output.updatedFindings.some(
    (f) => f.finding_type === 'confirmed_issue' && f.review_action === 'fix_before_launch',
  );
  if (hasBlocker) return true;
  if (output.residualBlocker !== undefined) return true;
  if (output.scenarioGaps.length > 0) return true;
  return false;
}
