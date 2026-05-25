/**
 * Provider-neutral audit log for AI calls.
 *
 * Per step 02d user direction: this file defines **only** the interface,
 * entry type, and a no-op default. It does NOT depend on `node:fs`, on
 * the artifact store, or on any other I/O. The real append-only file
 * writer (which materializes entries to
 * `<artifactDir>/<scanId>/scan-actions.log`) belongs to a later
 * orchestrator step — currently planned as Phase 2 step 14
 * (`src/core/audit/scan-actions-log.ts`); the exact landing site may
 * shift during Phase 2 planning.
 *
 * The entry shape is intentionally provider-neutral. Adding a new
 * provider adapter (OpenAI, Bedrock, etc.) is a registry change — the
 * log shape stays the same so downstream tooling does not need to
 * branch on provider.
 *
 * Trust-model constraints embedded in the shape:
 *
 *  - No `api_key` field. API keys must never appear in
 *    `scan-actions.log`. Adapters MUST scrub before recording.
 *  - `prompt_fingerprint_sha256` carries audit information about
 *    which prompt was sent without re-storing the prompt content.
 */

import type { ProviderId } from '../types/identity.js';

/**
 * Outcome tags an adapter records for each call. `'ok'` indicates the
 * call returned validated structured output; the other values mirror
 * `AiProviderError.kind` so the log and the error stream agree.
 */
export type AiCallOutcome =
  | 'ok'
  | 'schema_violation'
  | 'auth_error'
  | 'rate_limit'
  | 'network_error'
  | 'invalid_response'
  | 'prompt_injection_suspected';

export interface AiCallLogEntry {
  readonly action_id: 'ai_call';
  readonly provider_id: ProviderId;
  readonly model_id: string;
  readonly prompt_fingerprint_sha256: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly duration_ms: number;
  readonly outcome: AiCallOutcome;
  /** ISO-8601 timestamp recorded at call completion. */
  readonly recorded_at: string;
}

/**
 * The interface every adapter accepts. Implementations:
 *
 *  - `noopActionLogger` — the default; discards entries. Used in tests
 *    that don't need to assert on the log, and in any non-AI code path
 *    that constructs an `AiProvider` without orchestrator wiring.
 *  - A test fake — collects entries into an in-memory array so tests
 *    can assert on them.
 *  - The orchestrator-supplied append-only file writer (Phase 2
 *    step 14, `src/core/audit/scan-actions-log.ts`).
 */
export interface ActionLogger {
  record(entry: AiCallLogEntry): Promise<void>;
}

/**
 * No-op default. Calling `record` resolves immediately with no side
 * effect. Adapters use this when the caller does not supply a logger.
 */
export const noopActionLogger: ActionLogger = {
  record: () => Promise.resolve(),
};
