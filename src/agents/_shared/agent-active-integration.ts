/**
 * Codex retro 2.10-no-agent-integration: lightweight integration
 * helpers each Phase 1 agent calls from its run() to emit
 * TestPlanEntry[] for the controls it owns. The orchestrator
 * (step 2.14) collects these into a ProposedScanPlan that the
 * compiler (step 2.07c) validates.
 *
 * Each agent's contribution is small: build a list of TestPlanEntry
 * for the control_ids the agent owns, based on the agent's
 * findings (e.g. supabase-rls observes a likely_issue on cc-11-5,
 * so it proposes a cc-11-5 active test). The active test exists
 * to corroborate the deterministic heuristic with proven_allowed
 * or proven_denial.
 *
 * Per FPP §2A: this module dispatches on owning_agent_id (opaque
 * AnalyzerId), not closed unions on agent name.
 */

import type { Finding } from '../../types/finding.js';
import type { TestPlanEntry } from '../../types/active-validation.js';
import { buildTestPlanEntry } from './active-validation-extensions.js';

export function proposeTestsFromFindings(
  agentId: string,
  findings: readonly Finding[],
): readonly TestPlanEntry[] {
  // For every likely_issue / coverage_gap finding the agent emits on
  // a Phase 2-active-supported control, propose an active test of the
  // same control to corroborate or refute the heuristic.
  const out: TestPlanEntry[] = [];
  const seenControls = new Set<string>();
  for (const f of findings) {
    if (seenControls.has(f.control_id)) continue;
    if (f.finding_type === 'likely_issue' || f.finding_type === 'coverage_gap') {
      out.push(
        buildTestPlanEntry({
          testId: `${f.control_id}-active-${agentId}`,
          controlId: f.control_id,
          owningAgentId: agentId,
          requiredResources: ['identity', 'tenant'],
          ...(f.finding_type === 'likely_issue'
            ? { expectedOutcomeHint: 'proven_allowed' as const }
            : {}),
          maxDurationMs: 30_000,
        }),
      );
      seenControls.add(f.control_id);
    }
  }
  return out;
}
