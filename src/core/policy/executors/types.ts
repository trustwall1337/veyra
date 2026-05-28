import type { AgentExecutionContext } from '../../../types/agent-context.js';
import type { ConnectorId } from '../../../types/identity.js';
import type { Result } from '../../../types/result.js';
import type {
  AllowedAction,
  ValidationMode,
} from '../../../types/validation-policy.js';

export class ExecutorError extends Error {
  // Step 2.03: widened to `string` so subclasses (NotImplementedError,
  // executor-side policy wrappers) can carry their own name without
  // colliding with the base's literal narrowing.
  override readonly name: string = 'ExecutorError';
}

export interface ExecutionReceipt {
  readonly executorId: ConnectorId;
  readonly action: AllowedAction;
  readonly executed_at: string;
  readonly succeeded: boolean;
  readonly notes?: string;
}

/**
 * Typed stub for the Phase 2 active-validation seam.
 *
 * Phase 1 ships only this interface — no executor is registered or compiled
 * into the scan path. Phase 2's SandboxExecutor will implement this contract
 * and slot in via the service registry without a foundation refactor.
 */
export interface ActionExecutor {
  readonly id: ConnectorId;
  supportsMode(mode: ValidationMode): boolean;
  execute<A extends AllowedAction>(
    action: A,
    args: Readonly<Record<string, unknown>>,
    context: AgentExecutionContext,
  ): Promise<Result<ExecutionReceipt, ExecutorError>>;
}
