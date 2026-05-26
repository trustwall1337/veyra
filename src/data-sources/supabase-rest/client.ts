/**
 * Supabase Management REST client (step 27).
 *
 * Per step 27 §"Verified Supabase Management REST endpoints" — this
 * client commits to exactly three documented v1 endpoints:
 *
 *   GET /v1/projects/{ref}/database/openapi
 *   GET /v1/projects/{ref}/storage/buckets
 *   GET /v1/projects/{ref}/config/storage
 *
 * Beta and deprecated endpoints (`/database/query/read-only`,
 * `/database/context`) stay out of scope. Adding a new endpoint
 * requires a separate planner decision.
 *
 * Trust model:
 *  - `SUPABASE_ACCESS_TOKEN` rides only in the `Authorization` header;
 *    never on argv, never in any artifact, never in any log/error
 *    string (defense-in-depth via `redactTokenIn`).
 *  - Every call goes through a capability gate before the network. The
 *    gate is `ValidationPolicy.allowed_actions.has('<action>')`. There
 *    is NO `read_only` flag on this client; the mode is metadata.
 *  - Transport errors carry sanitized messages — the `Authorization`
 *    header never leaks into the surfaced `Error.message`.
 */

import type { Result } from '../../types/result.js';
import {
  DataSourceError,
  type DataSourceErrorKind,
} from '../../types/data-sources.js';
import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

export const SUPABASE_REST_BASE_URL = 'https://api.supabase.com';

export interface SupabaseRestClientOptions {
  readonly projectRef: string;
  readonly accessToken: string;
  readonly policy: ValidationPolicy;
  /**
   * Test seam. Production callers leave undefined and the client uses
   * global `fetch`. Tests inject a fake that returns recorded snapshot
   * responses (see `contract.test.ts`).
   */
  readonly fetchImpl?: typeof fetch;
  /** Optional override of the API base URL (test seam). */
  readonly baseUrl?: string;
}

export class SupabaseRestConfigurationError extends Error {
  override readonly name = 'SupabaseRestConfigurationError';
}

/**
 * Strip the access token from any string before it leaves the client.
 * Mirrors step 25's `redactTokenIn` discipline (defense-in-depth: the
 * token rides only in the `Authorization` header, but a misformatted
 * upstream error could echo it back).
 */
export function redactTokenIn(s: string, token: string): string {
  if (token.length === 0) return s;
  return s.split(token).join('REDACTED');
}

export interface SupabaseRestClient {
  /**
   * Fetch `GET /v1/projects/{ref}/database/openapi`. Requires
   * `read_schema_metadata` capability. Returns the parsed JSON body;
   * caller is responsible for extracting tables / RLS state from the
   * OpenAPI document.
   */
  getDatabaseOpenApi(): Promise<Result<unknown, DataSourceError>>;

  /**
   * Fetch `GET /v1/projects/{ref}/storage/buckets`. Requires
   * `read_storage_metadata` capability.
   */
  listStorageBuckets(): Promise<Result<unknown, DataSourceError>>;

  /**
   * Fetch `GET /v1/projects/{ref}/config/storage`. Requires
   * `read_storage_metadata` capability.
   */
  getStorageConfig(): Promise<Result<unknown, DataSourceError>>;
}

/**
 * Internal: route a GET through the capability gate, the network, and
 * the redaction wrapper. The action parameter names which allowed_action
 * must be present in `policy.allowed_actions`; without it, we return a
 * `capability_denied` DataSourceError without touching the network.
 */
async function gatedGet(
  url: string,
  action: AllowedAction,
  policy: ValidationPolicy,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Result<unknown, DataSourceError>> {
  if (!policy.allowed_actions.has(action)) {
    return {
      ok: false,
      error: new DataSourceError(
        'capability_denied',
        `Supabase REST call requires ${action} capability; not in policy.allowed_actions`,
      ),
    };
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: new DataSourceError(
        'transport_error',
        `Supabase REST GET ${redactUrlToken(url, token)} failed: ${redactTokenIn(raw, token)}`,
        cause,
      ),
    };
  }
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore — body unavailable
    }
    const sanitized = redactTokenIn(body, token).slice(0, 512);
    const kind: DataSourceErrorKind =
      response.status === 401 || response.status === 403
        ? 'capability_denied'
        : 'transport_error';
    return {
      ok: false,
      error: new DataSourceError(
        kind,
        `Supabase REST returned HTTP ${response.status} for ${redactUrlToken(url, token)}${sanitized.length > 0 ? ` — ${sanitized}` : ''}`,
      ),
    };
  }
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: new DataSourceError(
        'parse_error',
        `Supabase REST returned non-JSON body for ${redactUrlToken(url, token)}: ${redactTokenIn(raw, token)}`,
        cause,
      ),
    };
  }
  return { ok: true, value: body };
}

/**
 * URLs do not carry the token, but defense-in-depth: if a token-like
 * substring ever lands in a URL path/query (it shouldn't), strip it.
 */
function redactUrlToken(url: string, token: string): string {
  return redactTokenIn(url, token);
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{16,32}$/;

export function createSupabaseRestClient(
  options: SupabaseRestClientOptions,
): SupabaseRestClient {
  if (!PROJECT_REF_PATTERN.test(options.projectRef)) {
    throw new SupabaseRestConfigurationError(
      `Supabase project_ref must match ${PROJECT_REF_PATTERN.source}; got "${options.projectRef}"`,
    );
  }
  if (options.accessToken.length === 0) {
    throw new SupabaseRestConfigurationError(
      'Supabase access token is required; set SUPABASE_ACCESS_TOKEN in the shell',
    );
  }
  const baseUrl = options.baseUrl ?? SUPABASE_REST_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new SupabaseRestConfigurationError(
      'global fetch is not available; pass options.fetchImpl explicitly',
    );
  }
  const projectRef = options.projectRef;
  const token = options.accessToken;
  const policy = options.policy;
  const url = (path: string) =>
    `${baseUrl}/v1/projects/${projectRef}${path}`;

  return {
    getDatabaseOpenApi: () =>
      gatedGet(url('/database/openapi'), 'read_schema_metadata', policy, token, fetchImpl),
    listStorageBuckets: () =>
      gatedGet(url('/storage/buckets'), 'read_storage_metadata', policy, token, fetchImpl),
    getStorageConfig: () =>
      gatedGet(url('/config/storage'), 'read_storage_metadata', policy, token, fetchImpl),
  };
}
