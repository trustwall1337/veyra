import {
  DEEP_DIVE_SCOPE_TABLE,
  type SpawnDeepDiveProposal,
  targetDescriptorSchema,
} from '../tools/deep-dive.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

/**
 * The sub-agent spawn gate (Phase 3 / Agentic Veyra, Step 31c, PLAN §O +
 * `decisions.md` D6). The single deterministic authority for whether a
 * sub-agent may spawn. Three checks, in order:
 *
 *  1. **Depth cap = 1** — one integer compare. A sub-agent (`depth >= 1`) may
 *     not spawn further sub-agents (prevents unbounded recursion).
 *  2. **Typed target** — re-validates the proposal's `target_descriptor`
 *     against the closed `targetDescriptorSchema` (defense-in-depth even
 *     though `aiProposalSchema` already validated it at the loop boundary).
 *  3. **Policy admits at least one allowed action for this target kind** —
 *     looks up `DEEP_DIVE_SCOPE_TABLE` and asserts the intersection with
 *     `policy.allowed_actions` is non-empty. Otherwise the sub-agent could do
 *     nothing useful → deny.
 */

/** The depth cap. A sub-agent at this depth or higher may not spawn. */
export const DEEP_DIVE_DEPTH_CAP = 1;

export type SpawnDenialReason =
  | 'depth_cap'
  | 'invalid_target'
  | 'policy_forbids_actions';

export type SpawnDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: SpawnDenialReason };

/** The spawn gate. Pure, deterministic; the AI's stated intent never flips it. */
export function authorizeSpawn(input: {
  readonly proposal: SpawnDeepDiveProposal;
  readonly policy: ValidationPolicy;
  readonly depth: number;
}): SpawnDecision {
  if (input.depth >= DEEP_DIVE_DEPTH_CAP) {
    return { allowed: false, reason: 'depth_cap' };
  }
  const parsed = targetDescriptorSchema.safeParse(
    input.proposal.target_descriptor,
  );
  if (!parsed.success) {
    return { allowed: false, reason: 'invalid_target' };
  }
  const tableScope = DEEP_DIVE_SCOPE_TABLE[parsed.data.kind];
  const hasAtLeastOneAllowed = tableScope.allowed_actions.some((action) =>
    input.policy.allowed_actions.has(action),
  );
  if (!hasAtLeastOneAllowed) {
    return { allowed: false, reason: 'policy_forbids_actions' };
  }
  return { allowed: true };
}
