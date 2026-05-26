/**
 * Scan-actions audit log (step 2.14).
 *
 * Append-only audit spine for every state-changing action. Phase 2's
 * trust model treats this as the durable record: SandboxExecutor
 * writes here for every Admin API call; AiProvider adapters write
 * for every AI call; scanner adapters write for every subprocess;
 * MCP connectors write for every tool call.
 *
 * Per CLAUDE.md §Secrets: raw secret values NEVER appear in the
 * log. Args fingerprints are SHA-256 over the request envelope, not
 * the raw body. The append() helper computes the fingerprint at the
 * boundary; callers pass the structured args, never the raw key.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { type Result, err, ok } from '../../types/result.js';

export type ScanActionType =
  | 'ai_call'
  | 'admin_api_call'
  | 'mcp_call'
  | 'scanner_call'
  | 'orchestrator_phase'
  | 'cleanup_retry'
  | 'approval_consumed';

export type ScanActionOutcome =
  | 'ok'
  | 'denied'
  | 'failed'
  | 'timeout'
  | 'rate_limit'
  | 'budget_exceeded'
  | 'rolled_back'
  | 'skipped_missing_env';

export interface ScanActionLogEntry {
  readonly timestamp: string;
  readonly scan_id: string;
  readonly action_id: string;
  readonly action_type: ScanActionType;
  /** SHA-256 fingerprint over the action's structured args. Raw values NEVER appear. */
  readonly args_fingerprint_sha256: string;
  readonly outcome: ScanActionOutcome;
  readonly duration_ms: number;
  readonly context_tags?: Readonly<Record<string, string>>;
}

export interface ScanActionsLogger {
  append(entry: ScanActionLogEntry): Promise<Result<void, Error>>;
  summarize(): Promise<ScanActionsSummary>;
  /** Path to the on-disk log file (for diagnostics). */
  readonly logPath: string;
}

export interface ScanActionsSummary {
  readonly total_entries: number;
  readonly by_action_type: Readonly<Record<string, number>>;
  readonly by_outcome: Readonly<Record<string, number>>;
}

/**
 * SHA-256 fingerprint helper. Pure function so it can be called at
 * any boundary that produces an action. Caller passes a structured
 * args object; the helper hashes a deterministic JSON encoding.
 */
export function fingerprintActionArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex');
}

/**
 * Construct an append-only file-backed logger. Writes one
 * line-delimited JSON entry per `append()` call. Concurrent appends
 * are serialized via an in-process write queue (the log is per-scan
 * so cross-scan contention does not exist).
 */
export function createScanActionsLogger(
  artifactDir: string,
  scanId: string,
): ScanActionsLogger {
  const logPath = path.join(artifactDir, 'scan-actions.log');
  let chain: Promise<void> = Promise.resolve();
  const summary = {
    totalEntries: 0,
    byActionType: new Map<string, number>(),
    byOutcome: new Map<string, number>(),
  };

  return {
    logPath,
    async append(entry: ScanActionLogEntry): Promise<Result<void, Error>> {
      // Defense-in-depth: refuse entries whose scan_id differs from
      // the logger's scan_id. A misrouted call should surface as an
      // error, not silently land in the wrong log.
      if (entry.scan_id !== scanId) {
        return err(
          new Error(
            `scan-actions-log: scan_id mismatch (logger=${scanId}, entry=${entry.scan_id})`,
          ),
        );
      }
      // Defense-in-depth: refuse entries whose args_fingerprint is
      // suspicious (looks like a JWT or long base64 substring). The
      // fingerprint MUST be a 64-char hex SHA-256.
      if (!/^[0-9a-f]{64}$/.test(entry.args_fingerprint_sha256)) {
        return err(
          new Error(
            `scan-actions-log: args_fingerprint_sha256 is not a 64-char hex string — caller likely passed raw args instead of a fingerprint`,
          ),
        );
      }
      // Defense-in-depth: refuse entries whose context_tags carry
      // suspicious-looking high-entropy values.
      if (entry.context_tags !== undefined) {
        for (const [_k, v] of Object.entries(entry.context_tags)) {
          if (v.length > 32 && /^[A-Za-z0-9_+/=.\-]+$/.test(v)) {
            return err(
              new Error(
                `scan-actions-log: context_tags carries a high-entropy value (refused per CLAUDE.md §Secrets)`,
              ),
            );
          }
        }
      }
      chain = chain.then(async () => {
        await fs.mkdir(artifactDir, { recursive: true });
        await fs.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
        summary.totalEntries += 1;
        summary.byActionType.set(
          entry.action_type,
          (summary.byActionType.get(entry.action_type) ?? 0) + 1,
        );
        summary.byOutcome.set(
          entry.outcome,
          (summary.byOutcome.get(entry.outcome) ?? 0) + 1,
        );
      });
      try {
        await chain;
        return ok(undefined);
      } catch (cause) {
        const m = cause instanceof Error ? cause.message : String(cause);
        return err(new Error(`scan-actions-log append failed: ${m}`));
      }
    },
    async summarize(): Promise<ScanActionsSummary> {
      return {
        total_entries: summary.totalEntries,
        by_action_type: Object.fromEntries(summary.byActionType),
        by_outcome: Object.fromEntries(summary.byOutcome),
      };
    },
  };
}
