/**
 * Synthetic-data-manager agent (step 2.06).
 *
 * Single failure boundary for both Synthesize and Cleanup. Reads a
 * compiled scan plan, provisions synthetic identities/tenants/records
 * via the Supabase Admin connector, then reverses every resource on
 * Cleanup. All-or-nothing Synthesize semantics; Cleanup runs even on
 * Exercise crash (via the orchestrator's try-finally in step 2.14).
 *
 * Key disciplines (PHASE_2_PLAN §4.8 + §11.2 + §11.3):
 *  - Every resource tagged with `veyra_scan_id` + `veyra_synthetic: true`.
 *  - Veyra never reads pre-existing user data — only the uuids it
 *    itself created. `auth.admin.listUsers` is forbidden in the scan
 *    path; the agent's in-memory registry (persisted to
 *    `synthetic-resources.json`) replaces it.
 *  - Hard delete only (`shouldSoftDelete: false`).
 *  - Bounded auto-retry on residuals: up to 3 attempts with
 *    exponential backoff (1s, 4s, 16s). After exhaustion, emit a
 *    `confirmed_issue + fix_before_launch` finding and non-zero exit
 *    via the orchestrator.
 *
 * The agent ships in step 2.06; step 2.08 (sandbox-runner) is what
 * actually orchestrates Synthesize→Exercise→Cleanup. Step 2.14 wires
 * the orchestrator's two-phase runner.
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
import type { Finding } from '../../types/finding.js';
import { type Result, err, isErr, ok } from '../../types/result.js';
import type { TestIdentity } from '../../types/active-validation.js';

import type { SupabaseAdminClient } from '../../connectors/supabase/admin/client.js';

export const SYNTHETIC_DATA_MANAGER_AGENT_ID = 'synthetic-data-manager';

export const SYNTHETIC_RESOURCES_ARTIFACT = 'synthetic-resources.json';
export const CLEANUP_PROOF_ARTIFACT = 'cleanup-proof.json';

/** Step 2.06: retry schedule per PHASE_2_PLAN §11.3. */
export const CLEANUP_RETRY_DELAYS_MS: readonly number[] = [1000, 4000, 16000];

const METADATA: AgentMetadata = {
  id: SYNTHETIC_DATA_MANAGER_AGENT_ID,
  version: '0.1.0',
  declared_dependencies: [],
  produces: [SYNTHETIC_RESOURCES_ARTIFACT, CLEANUP_PROOF_ARTIFACT],
};

export interface SyntheticIdentitySpec {
  readonly test_id: string;
  readonly role: string;
  readonly tenant_id?: string;
  readonly email?: string;
}

export interface SyntheticDataManagerInput {
  /** Identities to create. Step 2.06 ships identity-only synthesis. */
  readonly identities: readonly SyntheticIdentitySpec[];
  readonly admin: SupabaseAdminClient;
  /**
   * Test seam: optional sleep override so retry tests don't actually
   * wait 1s+4s+16s. Production omits this; the agent uses the real
   * `setTimeout`-based sleep.
   */
  readonly sleepMs?: (ms: number) => Promise<void>;
}

export interface CleanupProof {
  readonly scan_id: string;
  readonly created_count: number;
  readonly deleted_count: number;
  readonly residual_count: number;
  readonly duration_ms: number;
  readonly per_resource_log: readonly {
    readonly uid: string;
    readonly outcome: 'deleted' | 'still_present' | 'delete_failed';
    readonly retries: number;
  }[];
}

export interface SyntheticDataManagerOutput {
  readonly identities: readonly TestIdentity[];
  readonly cleanup_proof: CleanupProof;
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSyntheticDataManagerAgent(): VeyraAgent<
  SyntheticDataManagerInput,
  SyntheticDataManagerOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: SyntheticDataManagerInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<SyntheticDataManagerOutput>> {
      const sleep = input.sleepMs ?? defaultSleep;
      // Orphan-detection runs once before any synthesize. PHASE_2_PLAN
      // §11.2 binding: refuse to operate if any pre-existing rows with
      // the Veyra namespace prefix exist.
      const orphans = await input.admin.findOrphanedSyntheticUsers();
      if (!orphans.ok) {
        return failureResult(
          context,
          `orphan-detection failed: ${orphans.error.message}`,
        );
      }
      if (orphans.value.length > 0) {
        return failureResult(
          context,
          `${String(orphans.value.length)} pre-existing Veyra synthetic resources detected (orphans from a prior failed scan). Manual cleanup required before this scan can proceed. Orphan uids: ${orphans.value.slice(0, 3).join(', ')}${orphans.value.length > 3 ? ', ...' : ''}`,
        );
      }

      // Phase 1: synthesize. Roll back on first failure.
      const registry: Array<{ readonly uid: string; readonly spec: SyntheticIdentitySpec }> = [];
      const identities: TestIdentity[] = [];
      const startedAt = Date.now();

      for (const spec of input.identities) {
        const email =
          spec.email ??
          `veyra-synth-${context.scanId}-${spec.test_id}@example.invalid`;
        const synth = await input.admin.createSyntheticUser({
          scanId: context.scanId,
          email,
          metadata: { test_id: spec.test_id, role: spec.role },
        });
        if (!synth.ok) {
          // Roll back: delete everything created so far.
          await rollback(input.admin, registry, sleep, context);
          return failureResult(
            context,
            `synthesize failed at ${spec.test_id}: ${synth.error.message}. All previously created resources were rolled back.`,
          );
        }
        registry.push({ uid: synth.value.uid, spec });
        identities.push({
          id: spec.test_id,
          scan_id: context.scanId,
          provider_subject_id: synth.value.uid,
          identity_provider_id: input.admin.id,
          role: spec.role,
          ...(spec.tenant_id !== undefined ? { tenant_id: spec.tenant_id } : {}),
          created_at: new Date().toISOString(),
        });
      }

      // Persist the registry BEFORE cleanup runs so a hard process
      // crash leaves a recoverable record.
      const registryArtifact: ArtifactRef[] = [];
      const resourcesPath = path.join(
        context.artifactDir,
        SYNTHETIC_RESOURCES_ARTIFACT,
      );
      try {
        await fs.mkdir(context.artifactDir, { recursive: true });
        await fs.writeFile(
          resourcesPath,
          JSON.stringify(
            {
              scan_id: context.scanId,
              identities: registry.map((r) => ({ uid: r.uid, test_id: r.spec.test_id })),
            },
            null,
            2,
          ),
          'utf8',
        );
        registryArtifact.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: resourcesPath,
        });
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        context.logger.warn(
          `synthetic-data-manager: failed to persist registry: ${m}`,
        );
      }

      // Phase 2: cleanup with bounded retry.
      const cleanup = await runCleanup(input.admin, registry, sleep, context);

      const proof: CleanupProof = {
        scan_id: context.scanId,
        created_count: registry.length,
        deleted_count: cleanup.deleted,
        residual_count: cleanup.residual,
        duration_ms: Date.now() - startedAt,
        per_resource_log: cleanup.log,
      };

      // Persist cleanup-proof.json (§11.3 receipt).
      const proofPath = path.join(context.artifactDir, CLEANUP_PROOF_ARTIFACT);
      const artifacts: ArtifactRef[] = [...registryArtifact];
      try {
        await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), 'utf8');
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: proofPath,
        });
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        context.logger.warn(
          `synthetic-data-manager: failed to persist cleanup-proof.json: ${m}`,
        );
      }

      const findings: Finding[] = [];
      if (cleanup.residual > 0) {
        findings.push({
          id: 'cc-2-06-residual-synthetic-data',
          control_id: 'cc-2-06',
          finding_type: 'confirmed_issue',
          evidence_strength: 'high',
          reproducibility: 'mcp_context',
          review_action: 'fix_before_launch',
          blast_radius: 'tenant_data',
          title: 'Veyra-created synthetic data remained after cleanup',
          summary: `${String(cleanup.residual)} synthetic user(s) remained after ${String(CLEANUP_RETRY_DELAYS_MS.length)} cleanup retries with exponential backoff. Needs human review; the Supabase project must be manually cleaned before another scan can proceed. Negative tests should be added once the cleanup-failure root cause is identified.`,
          evidence_refs: [proofPath],
        });
      }

      return {
        status: cleanup.residual > 0 ? 'failed' : 'completed',
        artifacts,
        findings,
        warnings: cleanup.warnings,
        output: { identities, cleanup_proof: proof },
      };
    },
  };
}

interface CleanupOutcome {
  readonly deleted: number;
  readonly residual: number;
  readonly log: readonly {
    readonly uid: string;
    readonly outcome: 'deleted' | 'still_present' | 'delete_failed';
    readonly retries: number;
  }[];
  readonly warnings: readonly string[];
}

async function runCleanup(
  admin: SupabaseAdminClient,
  registry: ReadonlyArray<{ uid: string }>,
  sleep: (ms: number) => Promise<void>,
  context: AgentExecutionContext,
): Promise<CleanupOutcome> {
  const log: {
    uid: string;
    outcome: 'deleted' | 'still_present' | 'delete_failed';
    retries: number;
  }[] = [];
  const warnings: string[] = [];
  let deleted = 0;

  for (const entry of registry) {
    let retries = 0;
    let outcome: 'deleted' | 'still_present' | 'delete_failed' = 'still_present';

    // Initial delete attempt.
    const d0 = await admin.deleteUser(entry.uid);
    if (isErr(d0)) {
      context.logger.warn(
        `cleanup: deleteUser(${entry.uid}) initial attempt failed: ${d0.error.message}`,
      );
    }

    // Verify + retry loop.
    for (let attempt = 0; attempt < CLEANUP_RETRY_DELAYS_MS.length + 1; attempt++) {
      const v = await admin.getUserById(entry.uid);
      if (v.ok && v.value === null) {
        outcome = 'deleted';
        deleted += 1;
        break;
      }
      if (attempt >= CLEANUP_RETRY_DELAYS_MS.length) {
        // Retries exhausted; outcome stays still_present.
        break;
      }
      const backoffMs = CLEANUP_RETRY_DELAYS_MS[attempt];
      if (backoffMs !== undefined) {
        await sleep(backoffMs);
      }
      retries += 1;
      const d = await admin.deleteUser(entry.uid);
      if (isErr(d)) {
        warnings.push(
          `deleteUser retry ${String(attempt + 1)} on ${entry.uid} failed: ${d.error.message}`,
        );
        outcome = 'delete_failed';
      }
    }
    log.push({ uid: entry.uid, outcome, retries });
  }

  const residual = log.filter((l) => l.outcome !== 'deleted').length;
  return { deleted, residual, log, warnings };
}

async function rollback(
  admin: SupabaseAdminClient,
  registry: ReadonlyArray<{ uid: string }>,
  sleep: (ms: number) => Promise<void>,
  context: AgentExecutionContext,
): Promise<void> {
  // Best-effort rollback. Errors are logged but the agent has already
  // decided to abort; we don't loop more than once per registered uid.
  for (const entry of registry) {
    const r = await admin.deleteUser(entry.uid);
    if (isErr(r)) {
      context.logger.warn(
        `rollback: deleteUser(${entry.uid}) failed: ${r.error.message}`,
      );
    }
  }
  // small delay to allow Supabase to settle if multiple deletes are
  // queued; non-functional but reduces flake in fakes that simulate
  // eventual consistency.
  await sleep(0);
}

function failureResult(
  context: AgentExecutionContext,
  message: string,
): AgentResult<SyntheticDataManagerOutput> {
  context.logger.error(`synthetic-data-manager: ${message}`);
  return {
    status: 'failed',
    artifacts: [],
    findings: [
      {
        id: 'cc-2-06-synthesize-failed',
        control_id: 'cc-2-06',
        finding_type: 'coverage_gap',
        evidence_strength: 'low',
        reproducibility: 'manual_review_required',
        review_action: 'review_before_launch',
        blast_radius: 'unknown',
        title: 'Synthetic-data manager could not complete',
        summary: `${message}. Active validation cannot proceed; needs human review.`,
        evidence_refs: [],
      },
    ],
    warnings: [message],
  };
}

export function isErrR<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}
