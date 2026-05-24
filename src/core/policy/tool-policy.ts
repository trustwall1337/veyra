import { PolicyViolationError } from '../../types/errors.js';
import { type Result, err, ok } from '../../types/result.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

export interface ToolCall {
  readonly serviceId: string;
  readonly tool: string;
  readonly action: AllowedAction;
}

/**
 * Gate a tool call against the active validation policy.
 *
 * Per CLAUDE.md §"Validation policy": this function consults
 * `policy.allowed_actions.has(...)` and `policy.forbidden_actions.has(...)`.
 * It MUST NOT branch on `policy.mode` — the mode is metadata for
 * reporting, never the authority for capability decisions.
 */
export function enforce(
  call: ToolCall,
  policy: ValidationPolicy,
): Result<void, PolicyViolationError> {
  if (policy.forbidden_actions.has(call.action)) {
    return err(
      new PolicyViolationError(
        `Action "${call.action}" is in the forbidden set for this policy (tool="${call.tool}", service="${call.serviceId}")`,
        call.action,
        call.serviceId,
      ),
    );
  }
  if (!policy.allowed_actions.has(call.action)) {
    return err(
      new PolicyViolationError(
        `Action "${call.action}" is not in the allowed set (tool="${call.tool}", service="${call.serviceId}")`,
        call.action,
        call.serviceId,
      ),
    );
  }
  return ok(undefined);
}
