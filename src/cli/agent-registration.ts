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

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuthnAgent } from '../agents/authn/index.js';
import { createAuthzTenantAgent } from '../agents/authz-tenant/index.js';
import { businessLogicAgent } from '../agents/business-logic/index.js';
import { evidenceReportAgent } from '../agents/evidence-report/index.js';
import { productUnderstandingAgent } from '../agents/product-understanding/index.js';
import { createSupabaseRlsAgent } from '../agents/supabase-rls/index.js';
import { toolRunnerAgent } from '../agents/tool-runner/index.js';
import type { GitleaksRunner } from '../scanners/gitleaks/types.js';
import type { OsvRunner } from '../scanners/osv/types.js';
import type { SemgrepRunner } from '../scanners/semgrep/types.js';
import { type ScanOrchestrator } from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentResult } from '../types/agent.js';

export interface RegistrationOptions {
  readonly supabaseSchemaSqlPath?: string;
  readonly storageBucketsArtifactPath?: string;
  readonly lockfilePath?: string;
  readonly rulesPath?: string;
  /**
   * Step 23 Bug C + D + retro-f1: scanner-runner injection. Production
   * callers pass no runners and the tool-runner falls back to the
   * default `child_process.spawn` runner. The end-to-end fixture gate
   * passes mocks that emit fixture-shape JSON deterministically so the
   * Bug C / Bug D regressions are caught regardless of which scanner
   * binaries are installed on the dev / CI machine.
   */
  readonly runners?: {
    readonly gitleaks?: GitleaksRunner;
    readonly osv?: OsvRunner;
    readonly semgrep?: SemgrepRunner;
  };
}

/**
 * Step 23 Bug C: locate the bundled `rules/` directory at the repo
 * root, relative to this module's URL. ESM-safe (works regardless of
 * `process.cwd()`).
 */
export function bundledRulesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/cli/ → ../../rules
  return path.resolve(here, '..', '..', 'rules');
}

/**
 * Step 23 Bug D: shallow lockfile discovery under `projectRoot`.
 * Probes the canonical names in npm / pnpm / yarn order. Returns
 * the first existing path or `undefined` if none found.
 */
export async function discoverLockfile(projectRoot: string): Promise<string | undefined> {
  const candidates = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  for (const name of candidates) {
    const candidate = path.join(projectRoot, name);
    try {
      const s = await fs.stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      // missing — try next
    }
  }
  return undefined;
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
    ...(options.runners !== undefined ? { runners: options.runners } : {}),
  }));

  // 3. supabase-rls (Layer 4 Pass-1 predicate, schema-driven).
  //    Registered only when a schema path is provided; otherwise the
  //    schema-facts predicates have no input and the agent would
  //    fail to read it.
  if (options.supabaseSchemaSqlPath !== undefined) {
    const supabaseSchemaSqlPath = options.supabaseSchemaSqlPath;
    const storageBucketsArtifactPath = options.storageBucketsArtifactPath;
    orch.register(createSupabaseRlsAgent(), (context: AgentExecutionContext) => ({
      schemaSqlPath: supabaseSchemaSqlPath,
      ...(storageBucketsArtifactPath !== undefined
        ? { storageBucketsArtifactPath }
        : {}),
      // Step 23 Bug A: wire inventory-bootstrap.json into supabase-rls
      // so its new cc-11-7 predicate can read env_declarations.
      inventoryArtifactPath: path.join(
        context.artifactDir,
        'inventory-bootstrap.json',
      ),
    }));
  }

  // 4. authn (Layer 4 Pass-1 predicate). Post retro-10b consumes
  //    scan-facts.json via deterministic predicates.
  orch.register(createAuthnAgent(), (context: AgentExecutionContext) => ({
    projectRoot: context.projectRoot,
    scanFactsArtifactPath: path.join(context.artifactDir, 'scan-facts.json'),
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
