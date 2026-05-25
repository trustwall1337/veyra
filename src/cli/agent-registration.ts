/**
 * Central agent registration.
 *
 * Per PHASE_1_PLAN §4.0: registry is a list; agents are addressed by
 * metadata. Adding a new agent = a new `register(...)` call here. No
 * `switch (agentId)` in shared code.
 */

import { businessLogicAgent } from '../agents/business-logic/index.js';
import { evidenceReportAgent } from '../agents/evidence-report/index.js';
import { productUnderstandingAgent } from '../agents/product-understanding/index.js';
import {
  type ScanOrchestrator,
} from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentResult } from '../types/agent.js';

/**
 * Register the Phase 1 agents that don't take input from runtime
 * config (input is shaped at the agent boundary). The full
 * orchestrator-driven scan path (with per-agent input builders for
 * supabase-rls / authn / authz-tenant / tool-runner) lands in 18b
 * where the post-revision artifacts (scan-facts.json) drive the
 * dispatch. This module is the seam for both phases.
 */
export function registerPhase1Agents(orch: ScanOrchestrator): void {
  // product-understanding: walks the project, optionally calls AI,
  // writes declared-context.json.
  orch.register(productUnderstandingAgent, (context: AgentExecutionContext) => ({
    projectRoot: context.projectRoot,
  }));

  // business-logic: reads declared-context.json, emits coverage_gap
  // findings + suggested negative tests.
  orch.register(businessLogicAgent, (context: AgentExecutionContext) => ({
    declaredContextPath: `${context.artifactDir}/declared-context.json`,
  }));

  // evidence-report: composes findings into ControlCard[] +
  // ReadinessReport.
  orch.register(
    evidenceReportAgent,
    (
      context: AgentExecutionContext,
      upstream: ReadonlyMap<string, AgentResult<unknown>>,
    ) => {
      const allFindings = Array.from(upstream.values()).flatMap(
        (r) => r.findings,
      );
      return {
        findings: allFindings,
        veyraVersion: '0.0.0',
        projectName: context.projectRoot.split('/').pop() ?? 'unnamed',
      };
    },
  );
}
