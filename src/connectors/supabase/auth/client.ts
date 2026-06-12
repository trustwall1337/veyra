import { type Result, err, ok } from '../../../types/result.js';
import { type ConnectorId, asConnectorId } from '../../../types/identity.js';

/**
 * Anon-key-scoped Supabase auth connector (Phase 3 / Step 40c-v3 Decision G).
 *
 * Promotes the `AuthSignInClient` shape inlined at
 * `src/agents/test-actor-manifest-reader/agent.ts:62-81` into a shared connector
 * so the Mode B Bedrock loop's `establish-actor-session` descriptor can sign
 * a synthetic user in via `auth.signInWithPassword` against the anon-key
 * client (NOT the service-role-key admin client — sign-in must use the public
 * surface so the produced JWT is identical to what a real client would send).
 *
 * Per Supabase docs the anon key is NOT a secret (it's the public client
 * identifier). Veyra still routes it via `--supabase-anon-key <ENV_VAR_NAME>`
 * (env-var NAME on argv, value in env) — symmetric with `--supabase-service-
 * role-key`, even though the anon key is technically public.
 *
 * Trust model:
 *  - The JWT returned here is held ONLY by `ActorSecretRegistry` (in process
 *    memory) and is NEVER persisted. Only `sha256(jwt)` lands on disk in
 *    `actor-sessions.json` (Decision G.2).
 *  - This file does NOT import `Finding` (`src/types/finding.ts`); V13's
 *    import-graph guard re-runs to assert reachability stays clean.
 */

const SUPABASE_AUTH_CONNECTOR_ID: ConnectorId = (() => {
  const r = asConnectorId('supabase-auth');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const supabaseAuthConnectorId: ConnectorId = SUPABASE_AUTH_CONNECTOR_ID;

/**
 * Narrow subset of the Supabase auth client surface the connector uses. The
 * sandbox path needs ONLY `auth.signInWithPassword` — no `signUp`, no
 * `signOut` (the admin signout path is handled by the admin connector via
 * Decision G.4), no token-refresh chains.
 */
export interface AuthSdkLike {
  readonly auth: {
    signInWithPassword(params: {
      email: string;
      password: string;
    }): Promise<{
      data: {
        session: {
          access_token: string;
          refresh_token?: string;
          expires_at?: number;
        } | null;
        user: { id: string } | null;
      };
      error: { status?: number; message: string } | null;
    }>;
  };
}

export interface SupabaseAuthClientOptions {
  /** Project API URL, e.g. `https://<ref>.supabase.co`. */
  readonly apiUrl: string;
  /** Public anon key for the project. Not a secret. */
  readonly anonKey: string;
  /**
   * Test seam: injected SDK client. Production callers leave undefined
   * and the connector constructs a real `createClient(...)` instance via
   * lazy import. The injected client must satisfy {@link AuthSdkLike}.
   */
  readonly sdkClient?: AuthSdkLike;
}

export interface SupabaseAuthSignInResult {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_at?: string;
  readonly user: { readonly id: string };
}

export interface SupabaseAuthClient {
  readonly id: ConnectorId;
  signInWithPassword(params: {
    readonly email: string;
    readonly password: string;
  }): Promise<Result<SupabaseAuthSignInResult, Error>>;
}

/** Lazy-import builder for `@supabase/supabase-js` `createClient` (anon-key). */
async function defaultAnonClient(
  apiUrl: string,
  anonKey: string,
): Promise<AuthSdkLike> {
  const mod = (await import('@supabase/supabase-js')) as unknown as {
    createClient: (url: string, key: string) => AuthSdkLike;
  };
  return mod.createClient(apiUrl, anonKey);
}

export function createSupabaseAuthClient(
  options: SupabaseAuthClientOptions,
): SupabaseAuthClient {
  if (options.apiUrl.length === 0) {
    throw new Error('supabase-auth requires a non-empty apiUrl');
  }
  if (options.anonKey.length === 0) {
    throw new Error(
      'supabase-auth requires a non-empty anon key (read from the env var named on --supabase-anon-key; the value never appears on argv)',
    );
  }
  const sdkPromise: Promise<AuthSdkLike> =
    options.sdkClient !== undefined
      ? Promise.resolve(options.sdkClient)
      : defaultAnonClient(options.apiUrl, options.anonKey);

  return {
    id: SUPABASE_AUTH_CONNECTOR_ID,
    async signInWithPassword(params) {
      try {
        const sdk = await sdkPromise;
        const response = await sdk.auth.signInWithPassword({
          email: params.email,
          password: params.password,
        });
        if (response.error !== null) {
          return err(
            new Error(
              `supabase-auth signInWithPassword failed: ${response.error.message}`,
            ),
          );
        }
        const session = response.data.session;
        const user = response.data.user;
        if (session === null || user === null) {
          return err(
            new Error(
              'supabase-auth signInWithPassword returned no session — likely email confirmation required or password mismatch',
            ),
          );
        }
        const expiresAtIso =
          session.expires_at !== undefined
            ? new Date(session.expires_at * 1000).toISOString()
            : undefined;
        return ok({
          access_token: session.access_token,
          ...(session.refresh_token !== undefined
            ? { refresh_token: session.refresh_token }
            : {}),
          ...(expiresAtIso !== undefined ? { expires_at: expiresAtIso } : {}),
          user: { id: user.id },
        });
      } catch (cause) {
        return err(cause instanceof Error ? cause : new Error(String(cause)));
      }
    },
  };
}
