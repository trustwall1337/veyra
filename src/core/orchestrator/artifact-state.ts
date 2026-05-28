import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { NamedFact, ToolResult } from '../../types/tool-result.js';

/**
 * Append-only loop state (Phase 3 / Agentic Veyra, PLAN §B). Every loop event
 * is recorded; accepted tool results are the ONLY thing the deterministic floor
 * reads (`collectAcceptedFacts`) — a rejected, errored, or denied call leaves
 * no fact behind, so a malformed/poisoned result can never reach the floor
 * (§D.1). Redaction of the view the AI sees and persistence to
 * `loop-trace.jsonl` are Step 34; here the records live in memory and the view
 * passes facts through.
 */

/** Discriminated kinds of loop event recorded in the append-only log. */
export type LoopRecordKind =
  | 'tool_accepted'
  | 'denial'
  | 'out_of_scope'
  | 'arg_reject'
  | 'tool_error'
  | 'tool_result_reject'
  | 'unknown_tool'
  | 'invalid_proposal'
  | 'spawn_denial'
  | 'subagent_error'
  | 'done'
  | 'early_done'
  | 'budget_halt'
  | 'stall_halt'
  | 'driver_error';

/** One append-only loop record. */
export interface LoopRecord {
  readonly seq: number;
  readonly kind: LoopRecordKind;
  readonly depth: number;
  readonly tool_id?: string;
  readonly reason?: string;
  readonly duration_ms?: number;
  readonly result_digest?: string;
  readonly parent_step?: number;
  readonly subagent_id?: string;
  /** For `early_done`: the unsatisfied ledger items. */
  readonly missing?: readonly string[];
}

/** An accepted, schema-parsed tool result (the only thing the floor reads). */
export interface AcceptedResult {
  readonly tool_id: string;
  readonly value: ToolResult;
  readonly digest: string;
  readonly duration_ms: number;
}

/** The redacted-in-Step-34 view handed to the AI driver each step. */
export interface LoopView {
  readonly steps: readonly {
    readonly seq: number;
    readonly kind: LoopRecordKind;
    readonly tool_id?: string;
  }[];
  /** Accepted facts so far. Pass-through here; redacted in Step 34. */
  readonly facts: readonly NamedFact[];
}

export interface ArtifactStateOptions {
  /** Scan artifact directory; `hasArtifact` checks files written here. */
  readonly artifactDir: string;
  /**
   * Optional hook fired (synchronously) every time a record is appended. Step
   * 34 uses this to emit one `loop-trace.jsonl` row per state record. The hook
   * MUST be fire-and-forget — internal failures must not block state mutation.
   */
  readonly onRecord?: (record: LoopRecord) => void;
}

/** Append-only loop state. */
export class ArtifactState {
  private readonly log: LoopRecord[] = [];
  private readonly acceptedByTool = new Map<string, AcceptedResult[]>();
  private seqCounter = 0;
  private probeAttempts = 0;

  constructor(private readonly options: ArtifactStateOptions) {}

  private push(record: Omit<LoopRecord, 'seq'>): void {
    this.seqCounter += 1;
    const full: LoopRecord = { seq: this.seqCounter, ...record };
    this.log.push(full);
    // Fire-and-forget hook: a trace-writer failure must not corrupt state.
    if (this.options.onRecord !== undefined) {
      try {
        this.options.onRecord(full);
      } catch {
        // intentionally swallowed
      }
    }
  }

  /** Persist an accepted, parsed result — the only path that feeds the floor. */
  writeToolResult(
    toolId: string,
    value: ToolResult,
    digest: string,
    durationMs: number,
    depth = 0,
  ): void {
    const list = this.acceptedByTool.get(toolId) ?? [];
    list.push({ tool_id: toolId, value, digest, duration_ms: durationMs });
    this.acceptedByTool.set(toolId, list);
    this.push({
      kind: 'tool_accepted',
      depth,
      tool_id: toolId,
      duration_ms: durationMs,
      result_digest: digest,
    });
  }

  recordDenial(toolId: string, reason: string, depth = 0): void {
    this.push({ kind: 'denial', depth, tool_id: toolId, reason });
  }
  recordOutOfScope(toolId: string, depth = 0): void {
    this.push({ kind: 'out_of_scope', depth, tool_id: toolId });
  }
  recordArgReject(toolId: string, reason: string, depth = 0): void {
    this.push({ kind: 'arg_reject', depth, tool_id: toolId, reason });
  }
  recordToolError(
    toolId: string,
    errorClass: string,
    durationMs: number,
    depth = 0,
  ): void {
    this.push({
      kind: 'tool_error',
      depth,
      tool_id: toolId,
      reason: errorClass,
      duration_ms: durationMs,
    });
  }
  recordToolResultReject(
    toolId: string,
    reason: string,
    durationMs: number,
    depth = 0,
  ): void {
    // reason ONLY — never the raw payload (no secret leak; §D.1).
    this.push({
      kind: 'tool_result_reject',
      depth,
      tool_id: toolId,
      reason,
      duration_ms: durationMs,
    });
  }
  recordUnknownTool(toolIdRaw: string, depth = 0): void {
    this.push({ kind: 'unknown_tool', depth, tool_id: toolIdRaw });
  }
  recordInvalidProposal(reason: string, depth = 0): void {
    this.push({ kind: 'invalid_proposal', depth, reason });
  }
  recordSpawnDenial(reason: string, depth = 0): void {
    this.push({ kind: 'spawn_denial', depth, reason });
  }
  recordSubagentError(
    subagentId: string,
    errorClass: string,
    parentStep: number,
    depth = 0,
  ): void {
    this.push({
      kind: 'subagent_error',
      depth,
      reason: errorClass,
      subagent_id: subagentId,
      parent_step: parentStep,
    });
  }
  recordDone(depth = 0): void {
    this.push({ kind: 'done', depth });
  }
  recordEarlyDone(missing: readonly string[], depth = 0): void {
    this.push({ kind: 'early_done', depth, missing });
  }
  recordBudgetHalt(trip: string, depth = 0): void {
    this.push({ kind: 'budget_halt', depth, reason: trip });
  }
  recordStallHalt(depth = 0): void {
    this.push({ kind: 'stall_halt', depth });
  }
  recordDriverError(errorClass: string, depth = 0): void {
    this.push({ kind: 'driver_error', depth, reason: errorClass });
  }

  /** Count a declared probe attempt (Mode B §K `declared_probe_attempted`). */
  recordProbeAttempt(): void {
    this.probeAttempts += 1;
  }
  probeAttemptCount(): number {
    return this.probeAttempts;
  }

  /** True iff a tool produced at least one accepted (parsed) result. */
  toolSucceeded(toolId: string): boolean {
    const list = this.acceptedByTool.get(toolId);
    return list !== undefined && list.length > 0;
  }

  /** True iff the named artifact basename was written to the scan dir. */
  hasArtifact(basename: string): boolean {
    return existsSync(path.join(this.options.artifactDir, basename));
  }

  /**
   * The facts the deterministic floor classifies — flattened from ONLY the
   * accepted results. Never reads raw invoke output.
   */
  collectAcceptedFacts(): readonly NamedFact[] {
    const out: NamedFact[] = [];
    for (const list of this.acceptedByTool.values()) {
      for (const accepted of list) out.push(...accepted.value.facts);
    }
    return out;
  }

  /** The redacted-in-Step-34 view handed to the AI driver. */
  readableView(): LoopView {
    return {
      steps: this.log.map((r) => ({
        seq: r.seq,
        kind: r.kind,
        ...(r.tool_id === undefined ? {} : { tool_id: r.tool_id }),
      })),
      facts: this.collectAcceptedFacts(),
    };
  }

  /** The full append-only record list (for the audit trail in Step 34). */
  records(): readonly LoopRecord[] {
    return this.log;
  }
}
