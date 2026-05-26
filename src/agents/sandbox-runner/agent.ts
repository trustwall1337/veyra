/**
 * Sandbox-runner agent (step 2.08).
 *
 * Executes the compiled scan plan against catalog tests. Per
 * PHASE_2_PLAN §3.3 / §4.9: synthetic JWT only, no service-role,
 * bounded per-test and per-scan timeouts, no retries.
 *
 * Per §12 (assertion strictness): the runner never promotes findings
 * to `confirmed_issue` — that promotion happens only in
 * evidence-report (step 2.10e) via `proven_allowed`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type {
  ActiveValidationResult,
  TestIdentity,
} from '../../types/active-validation.js';
import type { CompiledScanPlan } from '../../types/scan-plan.js';

import {
  ALL_ENTRIES,
  findEntryByControlId,
  type CatalogEntry,
  type HttpResponse,
  type HttpTransport,
  type NegativeTestInput,
} from './test-catalog/index.js';

export const SANDBOX_RUNNER_AGENT_ID = 'sandbox-runner';
export const ACTIVE_VALIDATION_RESULTS_ARTIFACT = 'active-validation-results.json';

const METADATA: AgentMetadata = {
  id: SANDBOX_RUNNER_AGENT_ID,
  version: '0.1.0',
  declared_dependencies: ['compiled-scan-plan.json', 'synthetic-resources.json'],
  produces: [ACTIVE_VALIDATION_RESULTS_ARTIFACT],
};

export interface SandboxRunnerInput {
  readonly compiledPlan: CompiledScanPlan;
  readonly identities: readonly TestIdentity[];
  readonly sessions: readonly { readonly test_id: string; readonly access_token: string }[];
  readonly transport: HttpTransport;
  readonly perTestTimeoutMs?: number;
  readonly perScanBudgetMs?: number;
  /** Catalog override for tests. Production callers leave undefined. */
  readonly catalog?: readonly CatalogEntry[];
}

export interface SandboxRunnerOutput {
  readonly results: readonly ActiveValidationResult[];
}

const DEFAULT_PER_TEST_TIMEOUT_MS = 30_000;
const DEFAULT_PER_SCAN_BUDGET_MS = 5 * 60 * 1000; // 5 minutes

export function createSandboxRunnerAgent(): VeyraAgent<
  SandboxRunnerInput,
  SandboxRunnerOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: SandboxRunnerInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<SandboxRunnerOutput>> {
      const perTest = input.perTestTimeoutMs ?? DEFAULT_PER_TEST_TIMEOUT_MS;
      const perScan = input.perScanBudgetMs ?? DEFAULT_PER_SCAN_BUDGET_MS;
      const catalog = input.catalog ?? ALL_ENTRIES;
      const catalogByControl = new Map(catalog.map((e) => [e.controlId, e]));

      const sessionByActor = new Map(
        input.sessions.map((s) => [s.test_id, s.access_token]),
      );
      const actorById = new Map(input.identities.map((i) => [i.id, i]));

      const results: ActiveValidationResult[] = [];
      const warnings: string[] = [];
      const scanStartedAt = Date.now();

      for (const entry of input.compiledPlan.entries) {
        const elapsed = Date.now() - scanStartedAt;
        if (elapsed > perScan) {
          // Per-scan budget exhausted; remaining tests become inconclusive.
          for (const remaining of input.compiledPlan.entries.slice(
            input.compiledPlan.entries.indexOf(entry),
          )) {
            results.push(
              budgetExceededResult(remaining.test_id, remaining.control_id, perScan),
            );
          }
          warnings.push('per_scan_budget_exhausted');
          break;
        }
        const catalogEntry =
          findEntryByControlId(entry.control_id) ??
          catalogByControl.get(entry.control_id);
        if (catalogEntry === undefined) {
          // Compiler should have rejected unknown control_ids; if we
          // reach here something drifted. Emit inconclusive.
          results.push(
            inconclusiveResult(
              entry.test_id,
              entry.control_id,
              'unknown_control_in_catalog',
            ),
          );
          warnings.push(`unknown control_id ${entry.control_id} in catalog`);
          continue;
        }
        // Pick an actor + JWT. Step 2.08 simple selection: first actor
        // whose role matches the catalog entry's expected actor (when
        // declared); fall back to first identity.
        const actor = pickActor(input.identities);
        if (actor === undefined) {
          results.push(
            inconclusiveResult(entry.test_id, entry.control_id, 'no_synthetic_actor_available'),
          );
          continue;
        }
        // Codex retro 2.08-actor-selection-and-session-mismatch +
        // 2.08-target-method-hardcoded: pick the actor whose role
        // matches the entry's actor_role parameter (when declared);
        // honor compiled method/body/headers from entry.parameters.
        // Empty access token on an authenticated catalog routes to
        // inconclusive_no_session rather than silently sending no
        // Authorization header.
        const requestedRole =
          typeof entry.parameters['actor_role'] === 'string'
            ? (entry.parameters['actor_role'] as string)
            : undefined;
        const pickedActor =
          requestedRole !== undefined
            ? input.identities.find((i) => i.role === requestedRole) ?? actor
            : actor;
        const pickedToken = sessionByActor.get(pickedActor.id) ?? '';
        if (
          pickedToken === '' &&
          !['cc-11-1', 'cc-11-12'].includes(entry.control_id)
        ) {
          results.push(
            inconclusiveResult(entry.test_id, entry.control_id, 'no_session_for_actor'),
          );
          continue;
        }
        const compiledMethodRaw =
          typeof entry.parameters['method'] === 'string'
            ? (entry.parameters['method'] as string)
            : 'GET';
        const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
        const compiledMethod = (allowedMethods as readonly string[]).includes(
          compiledMethodRaw,
        )
          ? (compiledMethodRaw as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')
          : 'GET';
        const compiledHeaders =
          typeof entry.parameters['headers'] === 'object' &&
          entry.parameters['headers'] !== null
            ? (entry.parameters['headers'] as Record<string, string>)
            : undefined;
        const compiledBody =
          typeof entry.parameters['body'] === 'object' &&
          entry.parameters['body'] !== null
            ? (entry.parameters['body'] as Record<string, unknown>)
            : undefined;

        const negInput: NegativeTestInput = {
          actor: pickedActor,
          target: {
            method: compiledMethod,
            url:
              extractUrlFromParameters(entry.parameters) ?? entry.validated_target_ref.ref,
            ...(compiledBody !== undefined ? { body: compiledBody } : {}),
            ...(compiledHeaders !== undefined ? { headers: compiledHeaders } : {}),
          },
          accessToken: pickedToken,
          transport: input.transport,
        };

        try {
          const r = await withTimeout(catalogEntry.run(negInput), perTest, () =>
            timeoutResult(entry.test_id, entry.control_id, perTest, pickedActor),
          );
          results.push(r);
        } catch (cause) {
          const m = cause instanceof Error ? cause.message : String(cause);
          warnings.push(`catalog test ${entry.test_id} threw: ${m}`);
          results.push(
            inconclusiveResult(entry.test_id, entry.control_id, `catalog_threw:${m}`),
          );
        }
      }

      // Persist.
      await fs.mkdir(context.artifactDir, { recursive: true });
      const outPath = path.join(
        context.artifactDir,
        ACTIVE_VALIDATION_RESULTS_ARTIFACT,
      );
      await fs.writeFile(
        outPath,
        JSON.stringify(
          { scan_id: context.scanId, results },
          null,
          2,
        ),
        'utf8',
      );

      const artifacts: ArtifactRef[] = [
        { scanId: context.scanId, kind: 'evidence_inventory', path: outPath },
      ];

      return {
        status: 'completed',
        artifacts,
        findings: [],
        warnings,
        output: { results },
      };
    },
  };
}

function pickActor(
  identities: readonly TestIdentity[],
): TestIdentity | undefined {
  if (identities.length === 0) return undefined;
  return identities[0];
}

function extractUrlFromParameters(
  params: Readonly<Record<string, unknown>>,
): string | undefined {
  const url = params['url'];
  return typeof url === 'string' ? url : undefined;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}

function timeoutResult(
  testId: string,
  controlId: string,
  ms: number,
  actor: TestIdentity,
): ActiveValidationResult {
  return {
    test_id: testId,
    control_id: controlId,
    outcome: 'inconclusive',
    evidence_refs: [],
    duration_ms: ms,
    synthetic_data_refs: [actor.id],
    assertion_details: { reason: 'timeout', timeout_ms: ms },
  };
}

function budgetExceededResult(
  testId: string,
  controlId: string,
  budgetMs: number,
): ActiveValidationResult {
  return {
    test_id: testId,
    control_id: controlId,
    outcome: 'inconclusive',
    evidence_refs: [],
    duration_ms: 0,
    synthetic_data_refs: [],
    assertion_details: { reason: 'budget_exceeded', budget_ms: budgetMs },
  };
}

function inconclusiveResult(
  testId: string,
  controlId: string,
  reason: string,
): ActiveValidationResult {
  return {
    test_id: testId,
    control_id: controlId,
    outcome: 'inconclusive',
    evidence_refs: [],
    duration_ms: 0,
    synthetic_data_refs: [],
    assertion_details: { reason },
  };
}

// Helper to expose response shape to tests + step 2.10e.
export type { HttpResponse, HttpTransport };
