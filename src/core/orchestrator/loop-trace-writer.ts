import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { TargetDescriptor } from '../tools/deep-dive.js';

import type { BudgetSnapshot } from './loop-budget.js';

/**
 * Per-step append-only audit trail (Phase 3 / Agentic Veyra, Step 34,
 * PLAN §F + §O). Every loop iteration emits exactly one
 * {@link LoopTraceRow} as a JSONL line to `loop-trace.jsonl`. Append-only +
 * per-step (not buffered) so a crash mid-loop still leaves a complete trace
 * up to the crash point. Every field that depends on tool output is computed
 * against the REDACTED parsed result — no raw secret is ever written here.
 */

/** The complete §F + §O trace row shape. Many fields are optional / nullable. */
export interface LoopTraceRow {
  readonly step: number;
  readonly recorded_at: string; // ISO-8601
  readonly depth: number; // 0 (parent) | 1 (sub-agent)

  readonly proposal_kind?:
    | 'invoke_tool'
    | 'done'
    | 'spawn_deep_dive'
    | 'invalid'
    | 'driver_error';
  readonly tool_id?: string;

  /** Args after redaction; never the raw AI proposal payload. */
  readonly args_redacted?: unknown;

  readonly gate_decision: 'allow' | 'deny' | 'n_a';
  readonly gate_reason?: string;
  readonly arg_validation: 'accepted' | 'rejected' | 'n_a';
  readonly result_validation: 'accepted' | 'rejected' | 'n_a';
  readonly result_reject_reason?: string;
  readonly invoke_status: 'ok' | 'error' | 'denied' | 'rejected' | 'n_a';
  readonly result_artifact_ref?: string;

  /** sha256 over the redacted parsed result — never the raw invoke output. */
  readonly result_digest?: string;
  readonly tool_duration_ms?: number;
  readonly tool_error_class?: string;

  readonly budget_snapshot: BudgetSnapshot;
  readonly policy_snapshot_hash: string;
  readonly descriptor_schema_version_hash: string;
  readonly state_view_digest: string;

  readonly model_id?: string;
  readonly prompt_fingerprint_sha256?: string;
  readonly alias_map_artifact_ref?: string;

  // D6 sub-agent fields (PLAN §O); subagent_depth ∈ {0, 1} only.
  readonly parent_step?: number | null;
  readonly subagent_id?: string;
  readonly subagent_target?: TargetDescriptor;
  readonly subagent_depth?: 0 | 1;
}

export interface LoopTraceWriter {
  /**
   * Append one trace row durably. Calls are SERIALISED through an internal
   * queue so two fire-and-forget invocations from the loop never interleave
   * bytes in the JSONL file. Each call resolves after its `fs.appendFile`
   * lands on disk (per-step, no buffer).
   */
  writeStep(row: LoopTraceRow): Promise<void>;
  /** Await any pending queued writes. The loop calls this at scan end. */
  flush(): Promise<void>;
  /** Absolute path of the JSONL file. */
  path: string;
}

/** Create a writer that appends to `<artifactDir>/loop-trace.jsonl`. */
export function createLoopTraceWriter(opts: {
  readonly artifactDir: string;
}): LoopTraceWriter {
  const filePath = path.join(opts.artifactDir, 'loop-trace.jsonl');
  let chain: Promise<void> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    path: filePath,
    writeStep: (row) =>
      enqueue(async () => {
        await fs.mkdir(opts.artifactDir, { recursive: true });
        // appendFile is durable per call; a crash after one append still
        // leaves earlier rows on disk. JSONL = one row per line; never
        // re-written.
        await fs.appendFile(filePath, JSON.stringify(row) + '\n', 'utf8');
      }),
    flush: () => chain,
  };
}
