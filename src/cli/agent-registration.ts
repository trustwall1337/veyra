/**
 * Central agent registration.
 *
 * Per PHASE_1_PLAN §4.0: registry is a list; agents are addressed by
 * metadata. Adding a new agent = a new `register(...)` call here. No
 * `switch (agentId)` in shared code.
 *
 * All seven Phase 1 agents register together. The orchestrator
 * topologically sorts by `declared_dependencies` so each agent runs
 * once its inputs are available. Per-agent input builders read
 * upstream artifacts from the artifact directory; agents that depend
 * on an artifact that was never written emit `coverage_gap` rather
 * than crashing (per their own contracts — see authn, supabase-rls).
 *
 * Lives under `src/cli/` (NOT `src/core/`) so the no-cross-layer-
 * imports test stays green — core never imports from agents/.
 */

import * as path from 'node:path';

import { createAuthnAgent } from '../agents/authn/index.js';
import { createAuthzTenantAgent } from '../agents/authz-tenant/index.js';
import { businessLogicAgent } from '../agents/business-logic/index.js';
import { evidenceReportAgent } from '../agents/evidence-report/index.js';
import { productUnderstandingAgent } from '../agents/product-understanding/index.js';
import { createSupabaseRlsAgent } from '../agents/supabase-rls/index.js';
import { toolRunnerAgent } from '../agents/tool-runner/index.js';
import { type ScanOrchestrator } from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentResult } from '../types/agent.js';

export interface RegistrationOptions {
  readonly supabaseSchemaSqlPath?: string;
  readonly storageBucketsArtifactPath?: string;
  readonly lockfilePath?: string;
  readonly rulesPath?: string;
}

export function registerPhase1Agents(
  orch: ScanOrchestrator,
  options: RegistrationOptions = {},
): void {
  // 1. product-understanding (Layer 1 + 1c, deterministic; AI layer
  //    1b only fires when an AiProvider is wired by the CLI).
  orch.register(productUnderstandingAgent, (context: AgentExecutionContext) => ({
    projectRoot: context.projectRoot,
  }));

  // 2. tool-runner (Layer 2 observation). Aggregates ScanFact[] from
  //    gitleaks + OSV + semgrep into scan-facts.json.
  orch.register(toolRunnerAgent, () => ({
    ...(options.lockfilePath !== undefined ? { lockfilePath: options.lockfilePath } : {}),
    ...(options.rulesPath !== undefined ? { rulesPath: options.rulesPath } : {}),
  }));

  // 3. supabase-rls (Layer 4 Pass-1 predicate, schema-driven).
  //    Registered only when a schema path is provided; otherwise the
  //    schema-facts predicates have no input and the agent would
  //    fail to read it.
  if (options.supabaseSchemaSqlPath !== undefined) {
    const supabaseSchemaSqlPath = options.supabaseSchemaSqlPath;
    const storageBucketsArtifactPath = options.storageBucketsArtifactPath;
    orch.register(createSupabaseRlsAgent(), () => ({
      schemaSqlPath: supabaseSchemaSqlPath,
      ...(storageBucketsArtifactPath !== undefined
        ? { storageBucketsArtifactPath }
        : {}),
    }));
  }

  // 4. authn (Layer 4 Pass-1 predicate). Reads tool-runner's
  //    scan-facts artifact when present.
  orch.register(createAuthnAgent(), (context: AgentExecutionContext) => ({
    projectRoot: context.projectRoot,
    scannerFindingsArtifactPath: path.join(context.artifactDir, 'scan-facts.json'),
  }));

  // 5. authz-tenant (Layer 4 Pass-1 predicate). Post retro-11b
  // consumes scan-facts.json instead of file-walking.
  orch.register(createAuthzTenantAgent(), (context: AgentExecutionContext) => ({
    projectRoot: context.projectRoot,
    scanFactsArtifactPath: path.join(context.artifactDir, 'scan-facts.json'),
    supabaseTablesArtifactPath: path.join(context.artifactDir, 'supabase-tables.json'),
  }));

  // 6. business-logic (Layer 4 Pass-1 predicate).
  orch.register(businessLogicAgent, (context: AgentExecutionContext) => ({
    declaredContextPath: path.join(context.artifactDir, 'declared-context.json'),
  }));

  // 7. evidence-report (final compose). Aggregates findings into
  //    ControlCard[] + ReadinessReport.
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
