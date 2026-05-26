/**
 * Codex retro 2.14-two-phase-orchestrator-missing +
 * 2.14-audit-spine-unused: Phase 2 two-phase runner.
 *
 * The Phase 1 orchestrator (`scan-orchestrator.ts`) is dependency-
 * layer scheduling. Phase 2's Synthesize → Exercise → Cleanup →
 * Prove sequence is a separate runner that wraps the Phase 1
 * orchestrator with the try-finally cleanup boundary §4.0 requires.
 *
 * Every state-changing action (synthesize call, sandbox HTTP call,
 * cleanup retry, approval consumption) writes one entry to
 * `scan-actions.log` via the audit spine (step 2.14).
 *
 * Step file Done-when:
 *  - Exercise crash → Cleanup still runs.
 *  - scan-actions.log shows the crash entry.
 *  - args-fingerprint never carries raw key/JWT/password.
 *
 * This module exposes a single function `runPhase2Scan` the CLI
 * (step 2.11 Mode B path) calls when --mode sandbox_active_validation
 * is the active mode AND all parse-time gates pass.
 */

import type { AgentExecutionContext } from '../../types/agent.js';
import type { CompiledScanPlan } from '../../types/scan-plan.js';
import type { ActiveValidationResult } from '../../types/scan-plan.js';
import type {
  CleanupProof,
  SyntheticIdentitySpec,
} from '../../agents/synthetic-data-manager/agent.js';
import type { SupabaseAdminClient } from '../../connectors/supabase/admin/client.js';
import type { HttpTransport } from '../../agents/sandbox-runner/test-catalog/index.js';
import {
  runSynthesizePhase,
  runCleanupPhase,
} from '../../agents/synthetic-data-manager/agent.js';
import { createSandboxRunnerAgent } from '../../agents/sandbox-runner/index.js';
import { createScanActionsLogger, fingerprintActionArgs } from '../../core/audit/scan-actions-log.js';

export interface Phase2RunnerInputs {
  readonly compiledPlan: CompiledScanPlan;
  readonly admin: SupabaseAdminClient;
  readonly transport: HttpTransport;
  readonly identities: readonly SyntheticIdentitySpec[];
  readonly context: AgentExecutionContext;
  /** Test seam: skip real backoff in synthesize/cleanup. */
  readonly sleepMs?: (ms: number) => Promise<void>;
}

export interface Phase2RunnerOutput {
  readonly active_validation_results: readonly ActiveValidationResult[];
  readonly cleanup_proof: CleanupProof;
  readonly synthesize_failed: boolean;
  readonly exercise_failed: boolean;
}

export async function runPhase2Scan(
  inputs: Phase2RunnerInputs,
): Promise<Phase2RunnerOutput> {
  const logger = createScanActionsLogger(
    inputs.context.artifactDir,
    inputs.context.scanId,
  );
  const t0 = Date.now();
  await logger.append({
    timestamp: new Date().toISOString(),
    scan_id: inputs.context.scanId,
    action_id: 'orchestrator_start',
    action_type: 'orchestrator_phase',
    args_fingerprint_sha256: fingerprintActionArgs({
      phase: 'synthesize',
      entry_count: inputs.compiledPlan.entries.length,
    }),
    outcome: 'ok',
    duration_ms: 0,
  });

  // Phase 1: Synthesize.
  const synth = await runSynthesizePhase(
    {
      identities: inputs.identities,
      admin: inputs.admin,
      ...(inputs.sleepMs !== undefined ? { sleepMs: inputs.sleepMs } : {}),
    },
    inputs.context,
  );
  if (!synth.ok) {
    await logger.append({
      timestamp: new Date().toISOString(),
      scan_id: inputs.context.scanId,
      action_id: 'synthesize_failed',
      action_type: 'orchestrator_phase',
      args_fingerprint_sha256: fingerprintActionArgs({ phase: 'synthesize' }),
      outcome: 'failed',
      duration_ms: Date.now() - t0,
    });
    return {
      active_validation_results: [],
      cleanup_proof: {
        scan_id: inputs.context.scanId,
        created_count: 0,
        deleted_count: 0,
        residual_count: 0,
        duration_ms: Date.now() - t0,
        per_resource_log: [],
      },
      synthesize_failed: true,
      exercise_failed: false,
    };
  }

  // Phase 2: Exercise (try) → Cleanup (finally).
  let exerciseResults: readonly ActiveValidationResult[] = [];
  let exerciseFailed = false;
  try {
    const runner = createSandboxRunnerAgent();
    const r = await runner.run(
      {
        compiledPlan: inputs.compiledPlan,
        identities: synth.value.identities,
        // Each identity uses synth-produced UID as access token slot.
        // Real JWT minting lands when the sandbox-executor's
        // call_api_with_test_identity handler is wired (step 2.06).
        sessions: synth.value.identities.map((i) => ({
          test_id: i.id,
          access_token: '',
        })),
        transport: inputs.transport,
      },
      inputs.context,
    );
    exerciseResults = r.output?.results ?? [];
  } catch (cause) {
    exerciseFailed = true;
    const m = cause instanceof Error ? cause.message : String(cause);
    await logger.append({
      timestamp: new Date().toISOString(),
      scan_id: inputs.context.scanId,
      action_id: 'exercise_crashed',
      action_type: 'orchestrator_phase',
      args_fingerprint_sha256: fingerprintActionArgs({
        phase: 'exercise',
        message: m,
      }),
      outcome: 'failed',
      duration_ms: Date.now() - t0,
    });
  } finally {
    // Cleanup ALWAYS runs (try-finally) — even on Exercise crash.
    const proof = await runCleanupPhase(
      synth.value.registry,
      inputs.admin,
      inputs.context,
      inputs.sleepMs,
    );
    await logger.append({
      timestamp: new Date().toISOString(),
      scan_id: inputs.context.scanId,
      action_id: 'cleanup_complete',
      action_type: 'orchestrator_phase',
      args_fingerprint_sha256: fingerprintActionArgs({
        phase: 'cleanup',
        residual_count: proof.residual_count,
      }),
      outcome: proof.residual_count === 0 ? 'ok' : 'failed',
      duration_ms: proof.duration_ms,
    });
    return {
      active_validation_results: exerciseResults,
      cleanup_proof: proof,
      synthesize_failed: false,
      exercise_failed: exerciseFailed,
    };
  }
}
