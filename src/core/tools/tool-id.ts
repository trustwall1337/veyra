import { type Result, err, ok } from '../../types/result.js';

/**
 * Opaque, branded identifier for a tool in the agentic-loop catalog
 * (Phase 3 / Agentic Veyra, PLAN §B). Per FPP §2A the core must not learn the
 * universe of tools: there is no closed union of tool ids anywhere. A new tool
 * registers a new `ToolId` via {@link asToolId}; the registry resolves ids to
 * descriptors without a central switch.
 */
export type ToolId = string & { readonly __brand: 'ToolId' };

/** Thrown-free error returned by {@link asToolId} for an invalid id string. */
export class InvalidToolIdError extends Error {
  override readonly name = 'InvalidToolIdError';
}

// Lower-kebab ids, mirroring the brand-id convention in `src/types/identity.ts`
// (e.g. `run-gitleaks`, `read-schema`). Keeps tool ids stable + filename-safe.
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Smart constructor for {@link ToolId}. Returns a `Result` rather than throwing
 * so callers handle an invalid id on an expected failure path (CLAUDE.md
 * §TypeScript conventions).
 */
export const asToolId = (value: string): Result<ToolId, InvalidToolIdError> => {
  if (value.length === 0) {
    return err(new InvalidToolIdError('ToolId cannot be empty'));
  }
  if (!TOOL_ID_PATTERN.test(value)) {
    return err(
      new InvalidToolIdError(
        `ToolId must match ${TOOL_ID_PATTERN.source}: got "${value}"`,
      ),
    );
  }
  return ok(value as ToolId);
};
