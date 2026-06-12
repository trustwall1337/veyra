import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { ActorSecretRegistry } from '../../../../core/sandbox/actor-secret-registry.js';
import {
  type ToolDescriptor,
  ToolInvocationError,
} from '../../../../core/tools/descriptor.js';
import { asToolId } from '../../../../core/tools/tool-id.js';
import type { WriteRegistry } from '../../../../core/sandbox/http-write-registry.js';
import { err, isErr, ok } from '../../../../types/result.js';
import {
  type ToolResult,
  toolResultSchema,
} from '../../../../types/tool-result.js';
import type { SupabaseAdminClient } from '../../admin/client.js';

/**
 * Tool id for the B.2 auto-synthesize step; referenced by the §K ledger
 * indirectly via `ACTIVE_PROBE_ACTIONS = ['call_api_with_test_identity',
 * 'create_synthetic_user']` (Decision A REUSE).
 */
export const SYNTHESIZE_ACTOR_TOOL_ID = 'synthesize-actor';

/**
 * Step 40c-v3 — synthesize-actor descriptor. Creates one synthetic user via
 * the SupabaseAdminClient with a random in-process-generated password, records
 * the {email, password} pair in the in-process ActorSecretRegistry, and
 * records a Path-2 admin WriteRegistry entry so cleanup deletes the user
 * (Decision G.4 — signOut runs before deleteUser as part of the reverse-walk
 * LIFO).
 *
 * The AI sees ONLY a digest of the actor handle + role + optional tenant_id.
 * The email + password + access_token live in ActorSecretRegistry, never
 * persisted, wiped in `runBedrockLoopBranchModeB`'s `finally` (V21).
 *
 * Trust model:
 *  - Required action: 'create_synthetic_user' (REUSE existing AllowedAction).
 *  - No Finding import (V13).
 *  - Result schema: ToolResult — whitelist-only NamedFact list; no
 *    classification keys at any depth.
 */
export const synthesizeActorArgsSchema = z.object({
  role: z.enum(['user', 'admin', 'tenant_a_user', 'tenant_b_user']),
  /** Optional tenant context for the actor (string id; freeform). */
  tenant_id: z.string().min(1).max(64).optional(),
});

export interface CreateSynthesizeActorToolDeps {
  readonly adminClient: SupabaseAdminClient;
  readonly writeRegistry: WriteRegistry;
  readonly actorSecretRegistry: ActorSecretRegistry;
  readonly scanId: string;
  /**
   * Override for randomBytes (test injection). Production callers leave
   * undefined and the descriptor uses node:crypto's randomBytes(32).
   */
  readonly passwordGenerator?: () => string;
}

export function createSynthesizeActorTool(
  deps: CreateSynthesizeActorToolDeps,
): ToolDescriptor<
  z.infer<typeof synthesizeActorArgsSchema>,
  ToolResult
> {
  const idR = asToolId(SYNTHESIZE_ACTOR_TOOL_ID);
  if (isErr(idR)) throw new Error(`invalid tool id: ${idR.error.message}`);

  return {
    tool_id: idR.value,
    title:
      'Synthesize a sandbox actor via Supabase Admin SDK (B.2 auto-synthesize); creates one user; password held in-process only',
    args_schema: synthesizeActorArgsSchema,
    result_schema: toolResultSchema,
    required_action: 'create_synthetic_user',
    source_module: 'src/connectors/supabase/admin-tools/synthesize-actor/tool.ts',
    invoke: async (args) => {
      // Generate a random password in-process. Held only in ActorSecretRegistry;
      // never persisted, never argv, never trace (CLAUDE.md §Secrets).
      const password =
        deps.passwordGenerator?.() ?? randomBytes(32).toString('base64url');

      // Synthesize the user via the Admin SDK.
      const r = await deps.adminClient.createSyntheticUser({
        scanId: deps.scanId,
        password,
        metadata: { role: args.role, ...(args.tenant_id !== undefined ? { tenant_id: args.tenant_id } : {}) },
      });
      if (!r.ok) {
        return err(
          new ToolInvocationError(
            `synthesize-actor: createSyntheticUser failed: ${r.error.message}`,
          ),
        );
      }
      const { uid, email } = r.value;
      if (email === undefined) {
        return err(
          new ToolInvocationError(
            'synthesize-actor: createSyntheticUser returned no email; cannot establish session',
          ),
        );
      }

      // Stash secrets in the in-process registry. NEVER serialized.
      deps.actorSecretRegistry.recordActor({
        actor_id: uid,
        email,
        password,
      });

      // Record the admin write so cleanup reverse-walks it (deleteUser).
      deps.writeRegistry.recordAdminWrite({
        resource_id: `supabase-admin:user:${uid}`,
        description_redacted: `synthesize-actor: created user uid=${uid} role=${args.role}`,
        cleanup_strategy: 'reverse',
      });

      // AI-facing facts: digest + role + optional tenant_id ONLY.
      const actor_handle_digest = createHash('sha256').update(uid).digest('hex');
      const facts = [
        { name: 'actor_id', value: uid },
        { name: 'actor_handle_digest', value: actor_handle_digest },
        { name: 'role', value: args.role },
        ...(args.tenant_id !== undefined
          ? [{ name: 'tenant_id' as const, value: args.tenant_id }]
          : []),
      ];
      return ok({ facts });
    },
  };
}
