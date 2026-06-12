import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
import type { SupabaseAuthClient } from '../../auth/client.js';

/**
 * Tool id matched verbatim by the §K ledger contract at
 * `required-evidence-ledger.ts:36` (`LEDGER_TOOL_IDS.establishActorSession`).
 * Decision B (v2 preserved): separate tool from synthesize-actor.
 */
export const ESTABLISH_ACTOR_SESSION_TOOL_ID = 'establish-actor-session';

/** Basename matched by `LEDGER_ARTIFACTS.actorSessions` at `:43`. */
export const ACTOR_SESSIONS_ARTIFACT = 'actor-sessions.json';

/**
 * Step 40c-v3 Decision G — sign in a synthesized actor via the anon-key-scoped
 * Supabase Auth client (`signInWithPassword`). Stores the resulting JWT in
 * `ActorSecretRegistry` (in-process only), persists `actor-sessions.json`
 * with the JWT digest ONLY (Decision G.2), and records a Path-2 admin
 * WriteRegistry entry so cleanup signs the actor out before deleteUser
 * (Decision G.4 — reverse-walk LIFO order: signOut → deleteUser).
 *
 * Trust model:
 *  - Required action: 'create_synthetic_user' (REUSE; Decision A — signing in
 *    is a contiguous step of creating).
 *  - Raw JWT NEVER touches `actor-sessions.json`, the loop trace, or any
 *    `LoopRecord.args_redacted` (V18 enforces).
 *  - No Finding import (V13).
 */
export const establishActorSessionArgsSchema = z.object({
  actor_id: z.string().min(1).max(128),
});

export interface ActorSessionRow {
  readonly actor_id: string;
  readonly role: string;
  readonly session_token_digest: string;
  readonly established_at: string;
  readonly expires_at?: string;
}

export interface CreateEstablishActorSessionToolDeps {
  readonly authClient: SupabaseAuthClient;
  readonly writeRegistry: WriteRegistry;
  readonly actorSecretRegistry: ActorSecretRegistry;
}

export function createEstablishActorSessionTool(
  deps: CreateEstablishActorSessionToolDeps,
): ToolDescriptor<
  z.infer<typeof establishActorSessionArgsSchema>,
  ToolResult
> {
  const idR = asToolId(ESTABLISH_ACTOR_SESSION_TOOL_ID);
  if (isErr(idR)) throw new Error(`invalid tool id: ${idR.error.message}`);

  return {
    tool_id: idR.value,
    title:
      'Sign in a synthesized actor via Supabase Auth (signInWithPassword); JWT held in-process only, digest persisted',
    args_schema: establishActorSessionArgsSchema,
    result_schema: toolResultSchema,
    required_action: 'create_synthetic_user',
    source_module:
      'src/connectors/supabase/admin-tools/establish-actor-session/tool.ts',
    invoke: async (args, context) => {
      // Resolve the actor's secrets from the in-process registry.
      const secret = deps.actorSecretRegistry.get(args.actor_id);
      if (secret === undefined) {
        return err(
          new ToolInvocationError(
            `establish-actor-session: unknown actor_id "${args.actor_id}"; was synthesize-actor called first?`,
          ),
        );
      }

      // Sign in via the anon-key client.
      const signinR = await deps.authClient.signInWithPassword({
        email: secret.email,
        password: secret.password,
      });
      if (!signinR.ok) {
        return err(
          new ToolInvocationError(
            `establish-actor-session: signInWithPassword failed for actor ${args.actor_id}: ${signinR.error.message}`,
          ),
        );
      }
      const { access_token, expires_at } = signinR.value;

      // Stash the JWT in the in-process registry. Never persisted.
      deps.actorSecretRegistry.recordSession({
        actor_id: args.actor_id,
        access_token,
        ...(expires_at !== undefined ? { expires_at } : {}),
      });

      // Persist actor-sessions.json with the DIGEST ONLY (Decision G.2).
      const session_token_digest = createHash('sha256')
        .update(access_token)
        .digest('hex');
      const established_at = new Date().toISOString();
      const role = await readActorRoleFromState(secret.actor_id);
      const row: ActorSessionRow = {
        actor_id: args.actor_id,
        role,
        session_token_digest,
        established_at,
        ...(expires_at !== undefined ? { expires_at } : {}),
      };
      const artifactDir = context.artifactDir;
      if (artifactDir !== undefined) {
        const sessionsPath = path.join(artifactDir, ACTOR_SESSIONS_ARTIFACT);
        let existing: ActorSessionRow[] = [];
        try {
          const raw = await fs.readFile(sessionsPath, 'utf8');
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) existing = parsed as ActorSessionRow[];
        } catch {
          // File doesn't exist yet — first session.
        }
        existing.push(row);
        await fs.mkdir(artifactDir, { recursive: true });
        await fs.writeFile(sessionsPath, JSON.stringify(existing, null, 2), 'utf8');
      }

      // Record the admin write so cleanup signOuts the actor's session.
      deps.writeRegistry.recordAdminWrite({
        resource_id: `supabase-auth:session:${args.actor_id}`,
        description_redacted: `establish-actor-session: signed in actor_id=${args.actor_id} session_token_digest=${session_token_digest.slice(0, 16)}…`,
        cleanup_strategy: 'reverse',
      });

      const facts = [
        { name: 'actor_id', value: args.actor_id },
        { name: 'role', value: role },
        { name: 'session_token_digest', value: session_token_digest },
        { name: 'established_at', value: established_at },
        ...(expires_at !== undefined
          ? [{ name: 'expires_at' as const, value: expires_at }]
          : []),
      ];
      return ok({ facts });
    },
  };
}

/**
 * Pull the role off the secret registry if recordActor stored it via metadata.
 * Since `ActorSecretRegistry` doesn't carry role today, fall back to a
 * sentinel — the role is also visible on the synthesize-actor result the AI
 * already saw, so this only affects the artifact row.
 */
async function readActorRoleFromState(actorId: string): Promise<string> {
  // No async work; the function shape is async for symmetry with future
  // role-source extensions (e.g. reading from a side-channel). Returns a
  // sentinel because role isn't captured in ActorSecret today.
  await Promise.resolve();
  return `synthetic:${actorId.slice(0, 8)}`;
}
