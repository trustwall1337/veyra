/**
 * `SandboxExecutor` — the first concrete `ActionExecutor` (step 2.03).
 *
 * Phase 2 implements active-validation via this executor. The shape:
 *
 *   1. The orchestrator constructs the executor with a per-connector
 *      handler bundle (Phase 2 ships Supabase handlers only).
 *   2. For each `execute(action, args, context)` call:
 *        - Confirm `policy.allowed_actions.has(action)` (per
 *          CLAUDE.md §Validation policy; NEVER branches on
 *          `policy.mode`).
 *        - Confirm the action is bound to a handler (otherwise
 *          PolicyViolationError).
 *        - Invoke the handler. Step 2.03 handlers all return
 *          `NotImplementedError`; step 2.06 replaces with real calls.
 *
 * Per FPP §2A: the executor is keyed by `ConnectorId`. Future Firebase
 * / Clerk synthetic-data executors register the same way — no
 * `if (provider === 'supabase')` branch anywhere in shared code.
 */

import type { AgentExecutionContext } from '../../../../types/agent.js';
import type { ConnectorId } from '../../../../types/identity.js';
import { type Result, err, ok } from '../../../../types/result.js';
import type {
  AllowedAction,
  ValidationMode,
  ValidationPolicy,
} from '../../../../types/validation-policy.js';

import {
  ExecutorError,
  type ActionExecutor,
  type ExecutionReceipt,
} from '../types.js';

import type { HandlerFn } from './handlers/supabase.js';

/**
 * Executor-side wrapper for a policy violation. Surfaces as
 * `ExecutorError` per the `ActionExecutor.execute` contract; carries
 * the same `PolicyViolationError` shape (action + serviceId) in the
 * message body so log aggregators can grep for either name.
 */
export class ExecutorPolicyViolationError extends ExecutorError {
  override readonly name: string = 'ExecutorPolicyViolationError';
  constructor(
    message: string,
    public readonly action: string,
    public readonly serviceId: string,
  ) {
    super(message);
  }
}

export interface SandboxExecutorOptions {
  readonly id: ConnectorId;
  /** Per-action handler bundle. Step 2.06 swaps in real implementations. */
  readonly handlers: Readonly<Record<AllowedAction, HandlerFn>>;
}

export function createSandboxExecutor(
  options: SandboxExecutorOptions,
): ActionExecutor {
  const handlers = options.handlers;

  return {
    id: options.id,
    supportsMode(mode: ValidationMode): boolean {
      // SandboxExecutor exists to serve `sandbox_active_validation`.
      // `read_only_evidence` calls never reach the executor (read
      // capabilities flow through connectors / data-sources, not
      // executors). `approved_production_safe` is a later phase.
      return mode === 'sandbox_active_validation';
    },
    async execute<A extends AllowedAction>(
      action: A,
      args: Readonly<Record<string, unknown>>,
      context: AgentExecutionContext,
    ): Promise<Result<ExecutionReceipt, ExecutorError>> {
      const policy: ValidationPolicy = context.policy;
      if (!policy.allowed_actions.has(action)) {
        return err(
          new ExecutorPolicyViolationError(
            `SandboxExecutor refused action "${action}": not in policy.allowed_actions (mode=${policy.mode})`,
            action,
            String(options.id),
          ),
        );
      }
      if (policy.forbidden_actions.has(action)) {
        return err(
          new ExecutorPolicyViolationError(
            `SandboxExecutor refused action "${action}": in policy.forbidden_actions`,
            action,
            String(options.id),
          ),
        );
      }
      const handler = handlers[action];
      if (handler === undefined) {
        return err(
          new ExecutorPolicyViolationError(
            `SandboxExecutor has no handler bound for action "${action}"`,
            action,
            String(options.id),
          ),
        );
      }
      return handler(action, args, context);
    },
  };
}

export type { ExecutionReceipt };
export { ok };
