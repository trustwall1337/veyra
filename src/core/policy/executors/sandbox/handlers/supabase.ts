/**
 * Sandbox-executor Supabase handler stubs (step 2.03).
 *
 * Each of the six synthetic-data actions is routed here when the
 * connector id is `supabase`. Step 2.03 ships stubs only — every
 * handler returns `Result.err(NotImplementedError)`. Step 2.06
 * (synthetic-data manager) wires the real Supabase Admin SDK calls.
 *
 * Per PHASE_2_PLAN §1.1: Supabase Admin API is a structurally separate
 * path from Supabase MCP. The MCP allowlist is NOT widened by this
 * step; Admin API calls use `@supabase/supabase-js` (already pinned
 * at 2.106.2 by step 2.01) and a service-role key supplied via env var.
 */

import type { AgentExecutionContext } from '../../../../../types/agent.js';
import { type Result, err } from '../../../../../types/result.js';
import type { AllowedAction } from '../../../../../types/validation-policy.js';
import type { ConnectorId } from '../../../../../types/identity.js';

import {
  ExecutorError,
  type ExecutionReceipt,
} from '../../types.js';

/**
 * Step 2.03 stub error. Subclass of ExecutorError so it satisfies
 * the `ActionExecutor.execute` return type; identity carried via the
 * prototype chain (no `override name` to avoid the literal-type
 * collision with the base class's `'ExecutorError'`).
 */
export class NotImplementedError extends ExecutorError {}

export interface SupabaseHandlerOptions {
  /** ConnectorId of the executor invoking the handler (for receipts). */
  readonly executorId: ConnectorId;
}

export type HandlerFn = (
  action: AllowedAction,
  args: Readonly<Record<string, unknown>>,
  context: AgentExecutionContext,
) => Promise<Result<ExecutionReceipt, ExecutorError>>;

/**
 * Step 2.06 will replace each `NotImplementedError` stub with a real
 * Admin SDK call. Until then, the executor returns the error cleanly
 * (no silent no-op) so any caller invoking these in Phase 2 step 2.03
 * scope sees an explicit "not yet implemented" rather than a fake ok.
 */
export function buildSupabaseHandlers(
  options: SupabaseHandlerOptions,
): Readonly<Record<AllowedAction, HandlerFn>> {
  const stub =
    (label: AllowedAction): HandlerFn =>
    async () =>
      err(
        new NotImplementedError(
          `Supabase handler for action "${label}" not implemented yet; lands in Phase 2 step 2.06 (synthetic-data manager). executor=${String(options.executorId)}`,
        ),
      );

  // Only the six synthetic-data actions are handled by SandboxExecutor.
  // Read actions ('read_code', 'read_schema_metadata', etc.) flow
  // through other paths (connectors, data-sources) and are NOT routed
  // here.
  return {
    read_code: stub('read_code'),
    read_schema_metadata: stub('read_schema_metadata'),
    read_storage_metadata: stub('read_storage_metadata'),
    read_scanner_logs: stub('read_scanner_logs'),
    read_application_logs: stub('read_application_logs'),
    create_synthetic_user: stub('create_synthetic_user'),
    create_synthetic_tenant: stub('create_synthetic_tenant'),
    create_synthetic_record: stub('create_synthetic_record'),
    call_api_with_test_identity: stub('call_api_with_test_identity'),
    verify_denial: stub('verify_denial'),
    cleanup_veyra_created_data: stub('cleanup_veyra_created_data'),
  };
}
