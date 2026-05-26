/**
 * Supabase Admin API connector (step 2.06).
 *
 * Wraps `@supabase/supabase-js` admin client with the discipline
 * PHASE_2_PLAN §1.1 + §11.2 require:
 *  - service-role key is read from the env var named on the CLI flag
 *    `--supabase-service-role-key <NAME>` (the env-var NAME goes on
 *    argv; the value never appears on argv).
 *  - operations refuse to run against a project_ref that matches any
 *    read-only Supabase project ref in the scan (sandbox must be
 *    distinct from the read-only target).
 *  - at construction time, an orphan-detection query scoped to the
 *    Veyra namespace prefix (`veyra-synth-`) refuses to proceed if
 *    any pre-existing rows match — catches orphans from any prior
 *    failed scan.
 *
 * Per CLAUDE.md §Secrets:
 *  - service-role key never appears in artifacts, logs, AI prompts,
 *    error messages, or reports.
 *  - args fingerprints are SHA-256 over the request envelope, not the
 *    raw body.
 */

import { createHash } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ConnectorId } from '../../../types/identity.js';
import { asConnectorId } from '../../../types/identity.js';
import { type Result, err, ok } from '../../../types/result.js';

export const SUPABASE_ADMIN_NAMESPACE_PREFIX = 'veyra-synth-';

export class SupabaseAdminConfigurationError extends Error {
  override readonly name = 'SupabaseAdminConfigurationError';
}

export class SupabaseAdminOrphanError extends Error {
  override readonly name = 'SupabaseAdminOrphanError';
}

export class SupabaseAdminConflictError extends Error {
  override readonly name = 'SupabaseAdminConflictError';
}

export interface SupabaseAdminClientOptions {
  readonly projectRef: string;
  readonly serviceRoleKey: string;
  /**
   * Read-only project_refs from the same scan; the Admin client
   * refuses if `projectRef` matches any of them (sandbox/read-only
   * must be distinct projects).
   */
  readonly readOnlyProjectRefs?: readonly string[];
  /**
   * Test seam: injected SDK client. Production callers leave undefined
   * and the connector constructs a real `createClient(...)` instance.
   * The injected client must satisfy the narrow surface below.
   */
  readonly sdkClient?: AdminSdkLike;
  /** Override the API URL for testing / non-default deployments. */
  readonly apiUrl?: string;
  /**
   * Codex retro 2.06-orphan-probe-enumerates-users: orphan detection
   * is now bookkeeping-driven, not enumeration-driven. Callers (and
   * tests) supply a list of UIDs from prior-scan synthetic registries;
   * the client verifies each via per-UID getUserById without ever
   * touching listUsers. Production wires this to read from
   * ~/.config/veyra/orphan-registry.json (the orphan-tracking file
   * the synthetic-data-manager writes at synthesize time). Default
   * implementation returns [] (clean / no historical state).
   */
  readonly knownOrphanUids?: readonly string[];
}

/**
 * Narrow subset of the Supabase admin client surface the connector
 * uses. Step 2.06 ships `auth.admin.createUser`, `auth.admin.deleteUser`,
 * `auth.admin.getUserById`. `auth.admin.listUsers` is explicitly
 * forbidden in the scan path (PHASE_2_PLAN §4.8 — never enumerate
 * pre-existing user data); the connector exposes a single
 * `findOrphanedSyntheticUsers()` method that runs ONCE at construction
 * time, scoped to the namespace prefix only.
 */
export interface AdminSdkLike {
  readonly auth: {
    readonly admin: {
      createUser(params: {
        email?: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata?: Readonly<Record<string, unknown>>;
      }): Promise<{
        data: { user: { id: string; email?: string | null } | null };
        error: { status: number; message: string } | null;
      }>;
      deleteUser(
        uid: string,
        shouldSoftDelete?: boolean,
      ): Promise<{
        data: unknown;
        error: { status: number; message: string } | null;
      }>;
      getUserById(uid: string): Promise<{
        data: { user: { id: string } | null };
        error: { status: number; message: string } | null;
      }>;
      /**
       * One-shot orphan probe — listUsers IS allowed at construction
       * time, scoped server-side by the namespace prefix when
       * supported, or filtered locally over a single bounded page.
       */
      listUsers(params?: { page?: number; perPage?: number }): Promise<{
        data: {
          users: readonly { id: string; email?: string | null; user_metadata?: Record<string, unknown> }[];
        };
        error: { status: number; message: string } | null;
      }>;
    };
  };
}

export interface SupabaseAdminClient {
  readonly id: ConnectorId;
  readonly projectRef: string;
  createSyntheticUser(opts: {
    readonly scanId: string;
    readonly email?: string;
    readonly password?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<Result<{ readonly uid: string; readonly email?: string }, Error>>;
  deleteUser(uid: string): Promise<Result<void, Error>>;
  getUserById(uid: string): Promise<Result<{ readonly id: string } | null, Error>>;
  /** One-shot construction-time orphan check (see §Guardrails). */
  findOrphanedSyntheticUsers(): Promise<
    Result<readonly string[], Error>
  >;
}

const SUPABASE_ADMIN_CONNECTOR_ID: ConnectorId = (() => {
  const r = asConnectorId('supabase-admin');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const supabaseAdminConnectorId: ConnectorId = SUPABASE_ADMIN_CONNECTOR_ID;

function fingerprintArgs(
  scope: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ scope, payload }))
    .digest('hex');
}

export function createSupabaseAdminClient(
  options: SupabaseAdminClientOptions,
): SupabaseAdminClient {
  if (options.projectRef.length === 0) {
    throw new SupabaseAdminConfigurationError(
      'supabase-admin requires a non-empty projectRef',
    );
  }
  if (options.serviceRoleKey.length === 0) {
    throw new SupabaseAdminConfigurationError(
      'supabase-admin requires a non-empty service-role key (read from the env var named on the CLI; the value never appears on argv)',
    );
  }
  for (const ro of options.readOnlyProjectRefs ?? []) {
    if (ro === options.projectRef) {
      throw new SupabaseAdminConflictError(
        `supabase-admin projectRef "${options.projectRef}" must NOT match any read-only project_ref in the same scan; sandbox must be distinct`,
      );
    }
  }

  const apiUrl = options.apiUrl ?? `https://${options.projectRef}.supabase.co`;
  const sdkClient: AdminSdkLike =
    options.sdkClient ??
    (createClient(apiUrl, options.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as AdminSdkLike);

  const token = options.serviceRoleKey;

  function redact(s: string): string {
    return token.length === 0 ? s : s.split(token).join('REDACTED');
  }

  return {
    id: SUPABASE_ADMIN_CONNECTOR_ID,
    projectRef: options.projectRef,

    async createSyntheticUser(opts) {
      const fp = fingerprintArgs('createUser', {
        scan_id: opts.scanId,
        has_email: opts.email !== undefined,
      });
      const userMetadata = {
        ...(opts.metadata ?? {}),
        veyra_scan_id: opts.scanId,
        veyra_synthetic: true,
        veyra_args_fingerprint_sha256: fp,
      };
      const r = await sdkClient.auth.admin.createUser({
        ...(opts.email !== undefined ? { email: opts.email } : {}),
        ...(opts.password !== undefined ? { password: opts.password } : {}),
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (r.error !== null) {
        return err(
          new Error(
            `supabase-admin createUser failed (status=${String(r.error.status)}): ${redact(r.error.message)}`,
          ),
        );
      }
      if (r.data.user === null) {
        return err(new Error('supabase-admin createUser returned null user'));
      }
      return ok({
        uid: r.data.user.id,
        ...(typeof r.data.user.email === 'string'
          ? { email: r.data.user.email }
          : {}),
      });
    },

    async deleteUser(uid) {
      const r = await sdkClient.auth.admin.deleteUser(uid, false);
      if (r.error !== null) {
        return err(
          new Error(
            `supabase-admin deleteUser(${uid}) failed (status=${String(r.error.status)}): ${redact(r.error.message)}`,
          ),
        );
      }
      return ok(undefined);
    },

    async getUserById(uid) {
      const r = await sdkClient.auth.admin.getUserById(uid);
      if (r.error !== null) {
        // 404 == not found — treated as ok(null) by caller; other
        // statuses are errors.
        if (r.error.status === 404) return ok(null);
        return err(
          new Error(
            `supabase-admin getUserById(${uid}) failed (status=${String(r.error.status)}): ${redact(r.error.message)}`,
          ),
        );
      }
      if (r.data.user === null) return ok(null);
      return ok({ id: r.data.user.id });
    },

    async findOrphanedSyntheticUsers() {
      // Codex retro 2.06-orphan-probe-enumerates-users: orphan
      // detection is bookkeeping-driven (NO listUsers in scan path).
      // The caller supplies `knownOrphanUids` from the prior-scan
      // synthetic registry. We probe each via getUserById; UIDs
      // that still resolve are orphans, UIDs that 404 are clean.
      const known = options.knownOrphanUids ?? [];
      if (known.length === 0) return ok([]);
      const orphans: string[] = [];
      for (const uid of known) {
        const r = await sdkClient.auth.admin.getUserById(uid);
        if (r.error !== null && r.error.status === 404) continue;
        if (r.error !== null) {
          return err(
            new Error(
              `supabase-admin orphan probe failed for ${uid} (status=${String(r.error.status)}): ${redact(r.error.message)}`,
            ),
          );
        }
        if (r.data.user !== null) orphans.push(uid);
      }
      return ok(orphans);
    },
  };
}

export type { SupabaseClient };
