import { type Result, err, ok } from '../../types/result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';
import {
  DEEP_DIVE_SCOPE_TABLE,
  type TargetDescriptor,
} from '../tools/deep-dive.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolId } from '../tools/tool-id.js';

/**
 * Pure deterministic sub-scope derivation (Phase 3 / Step 31c, PLAN §O / D6).
 * Given a typed `TargetDescriptor`, the parent's current scope, and the active
 * policy, returns the **strict subset** of `parentScope` whose tools are in
 * the table-derived action scope AND allowed by policy.
 *
 * Invariants (asserted; failure = `Result.err(ScopeError)`):
 *  - Result is a STRICT subset of `parentScope` (`size < parentScope.size`).
 *  - Result is non-empty (a sub-agent with no tools is useless).
 *  - Every member is filtered FROM `parentScope` (no tool promotion).
 *  - Every member's `required_action` is in `policy.allowed_actions`.
 *  - Object-identity holds via the shared `ToolRegistry` (the resolved
 *    descriptor for an id IS the parent's descriptor).
 */

export class ScopeError extends Error {
  override readonly name = 'ScopeError';
}

export function deriveSubScope(input: {
  readonly target: TargetDescriptor;
  readonly parentScope: ReadonlySet<ToolId>;
  readonly registry: ToolRegistry;
  readonly policy: ValidationPolicy;
}): Result<ReadonlySet<ToolId>, ScopeError> {
  const tableScope = DEEP_DIVE_SCOPE_TABLE[input.target.kind];
  const allowedActions = new Set(
    tableScope.allowed_actions.filter((action) =>
      input.policy.allowed_actions.has(action),
    ),
  );

  const sub = new Set<ToolId>();
  for (const id of input.parentScope) {
    const descriptor = input.registry.resolve(id);
    if (descriptor === undefined) continue; // ids resolve via the shared registry
    if (allowedActions.has(descriptor.required_action)) {
      sub.add(id);
    }
  }

  if (sub.size === 0) {
    return err(
      new ScopeError(
        `sub-scope is empty for target.kind=${input.target.kind} under the active policy`,
      ),
    );
  }
  if (sub.size >= input.parentScope.size) {
    return err(
      new ScopeError(
        `sub-scope is not a strict subset of the parent (sub=${String(sub.size)}, parent=${String(input.parentScope.size)})`,
      ),
    );
  }
  return ok(sub);
}
