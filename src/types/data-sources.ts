/**
 * Capability-shaped data-source interfaces (step 27).
 *
 * Step 27 demotes Supabase MCP from primary to alternative backend and
 * introduces REST as the default. To stay faithful to FPP §2A (no
 * closed unions on service identity in shared types), the seam is a
 * set of narrow capability interfaces, not a wide `ProjectDataSource`.
 * Three interfaces, three discriminators:
 *
 *  - `DatabaseMetadataSource`: tables, RLS policies (when exposed).
 *  - `StorageMetadataSource`:  buckets + storage configuration.
 *  - `CodeSource`:             file walk + read for code-grep agents.
 *
 * Each interface carries an opaque `DataSourceId` brand (no closed
 * `'supabase-rest' | 'supabase-mcp'` union anywhere in shared code).
 * The registry in `src/data-sources/registry.ts` resolves ids to
 * factories at runtime.
 *
 * Per CLAUDE.md §Validation policy: capability access is gated by
 * `ValidationPolicy.allowed_actions`, NOT by a `read_only` flag.
 * Implementations check `policy.allowed_actions.has('<action>')` at
 * the call site; the mode is metadata. There is no `read_only` boolean
 * on any of these interfaces.
 */

import type { Result } from './result.js';

/**
 * Opaque branded identifier for a data-source backend (e.g.
 * `supabase-rest`, `supabase-mcp`, `local-sql-file`, `lovable-github-clone`).
 * Per FPP §2A: the compiler must NOT learn the universe of backends.
 * New backends register a new `DataSourceId` via the registry; no
 * shared-type edits, no `switch (id)` in shared code.
 */
export type DataSourceId = string & { readonly __brand: 'DataSourceId' };

export class InvalidDataSourceIdError extends Error {
  override readonly name = 'InvalidDataSourceIdError';
}

const DATA_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export function asDataSourceId(
  value: string,
): Result<DataSourceId, InvalidDataSourceIdError> {
  if (value.length === 0) {
    return {
      ok: false,
      error: new InvalidDataSourceIdError('DataSourceId cannot be empty'),
    };
  }
  if (!DATA_SOURCE_ID_PATTERN.test(value)) {
    return {
      ok: false,
      error: new InvalidDataSourceIdError(
        `DataSourceId must match ${DATA_SOURCE_ID_PATTERN.source}: got "${value}"`,
      ),
    };
  }
  return { ok: true, value: value as DataSourceId };
}

/**
 * A single table snapshot returned by `DatabaseMetadataSource.fetchTables()`.
 * Shape is intentionally a subset of the existing parser's `ParsedTable`
 * so the supabase-rls agent can consume either path uniformly. RLS-enabled
 * flag is the deterministic signal cc-11-5 / cc-11-9 keys on.
 */
export interface TableSnapshot {
  readonly schema: string;
  readonly name: string;
  readonly rls_enabled: boolean;
  /**
   * Source span when the upstream is a parsed SQL file. REST and MCP
   * backends omit this — they don't have line numbers, just metadata.
   */
  readonly source_range?: { readonly start: number; readonly end: number };
}

/**
 * Single RLS policy snapshot when the backend exposes one.
 *
 * Step 27 honest-limitation: the Supabase Management REST `database/openapi`
 * endpoint may not expose policy USING / WITH CHECK expressions. When that
 * is the case, `DatabaseMetadataSource.fetchPolicies()` returns a
 * `DataSourceError` with `kind: 'capability_not_exposed'` and the
 * caller emits a `coverage_gap` finding rather than silently missing
 * policy-level checks. The MCP backend (alternative) still surfaces
 * policy bodies.
 */
export interface PolicySnapshot {
  readonly name: string;
  readonly schema: string;
  readonly table: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  readonly role?: string;
  readonly using_expr?: string;
  readonly with_check_expr?: string;
}

export interface BucketSnapshot {
  readonly id: string;
  readonly name: string;
  /** True when bucket is publicly readable. False when private. */
  readonly public: boolean;
}

export interface StorageConfig {
  /** Maximum file size in bytes (Supabase project-level setting). */
  readonly fileSizeLimit?: number;
  /** Whether image transformation is enabled for the project. */
  readonly imageTransformEnabled?: boolean;
}

export interface FileWalkEntry {
  /** Path relative to the walk root. */
  readonly path: string;
  readonly bytes: number;
}

export interface FileWalkResult {
  readonly root: string;
  readonly entries: readonly FileWalkEntry[];
}

/**
 * Tagged error returned by every capability call. Each `kind` maps to a
 * specific class of customer-facing outcome:
 *
 *  - `capability_denied`:      `policy.allowed_actions` did not contain
 *                              the required action. The call never went
 *                              over the wire.
 *  - `transport_error`:        the network / subprocess call failed
 *                              (HTTP non-2xx, connection refused, etc.).
 *                              Per CLAUDE.md §Secrets, the wrapped
 *                              `message` is already token-redacted.
 *  - `parse_error`:            the response decoded but did not match
 *                              the expected shape (e.g. OpenAPI doc
 *                              missing `paths`).
 *  - `capability_not_exposed`: the backend has no surface that answers
 *                              this question (e.g. REST does not return
 *                              policy bodies). Caller emits a
 *                              `coverage_gap` finding.
 *  - `plan_not_available`:     the backend's authorization succeeded
 *                              but the customer's plan tier denies
 *                              access to this capability (step 28
 *                              Lovable Free-tier rejection). Caller
 *                              emits a `coverage_gap` finding and
 *                              points the customer at the alternative
 *                              path (local-clone for Lovable). The
 *                              backend's sanitized status/error code
 *                              flows into the finding message; raw
 *                              response bodies do not.
 */
export type DataSourceErrorKind =
  | 'capability_denied'
  | 'transport_error'
  | 'parse_error'
  | 'capability_not_exposed'
  | 'plan_not_available';

export class DataSourceError extends Error {
  override readonly name = 'DataSourceError';
  constructor(
    public readonly kind: DataSourceErrorKind,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Reads database-level metadata (tables, RLS state, policy bodies when
 * exposed). Implementations live under `src/data-sources/<backend>/`.
 * The supabase-rls agent consumes one of these; it does NOT know which
 * backend produced the snapshot.
 *
 * Capability gating: `fetchTables` requires `read_schema_metadata`,
 * `fetchPolicies` requires the same. Implementations check at call site.
 */
export interface DatabaseMetadataSource {
  readonly id: DataSourceId;
  fetchTables(): Promise<Result<readonly TableSnapshot[], DataSourceError>>;
  fetchPolicies(): Promise<Result<readonly PolicySnapshot[], DataSourceError>>;
}

/**
 * Reads storage-bucket metadata + storage configuration.
 *
 * Per step 27 CLAUDE.md amendment: storage bucket state may come from
 * REST OR MCP, gated by `policy.allowed_actions.has('read_storage_metadata')`.
 * The schema.sql path remains excluded for storage (Supabase `db dump`
 * does not include the managed `storage` schema).
 */
export interface StorageMetadataSource {
  readonly id: DataSourceId;
  fetchBuckets(): Promise<Result<readonly BucketSnapshot[], DataSourceError>>;
  fetchStorageConfig(): Promise<Result<StorageConfig, DataSourceError>>;
}

/**
 * Reads code from the customer's project. Phase 1 has one implementation:
 * `lovable-github-clone` (local filesystem walk after the customer ran
 * `git clone`). Phase 2 may add an OAuth-based Lovable file fetcher —
 * step 28's deferred work.
 *
 * Capability gating: walk + read require `read_code`.
 */
export interface CodeSource {
  readonly id: DataSourceId;
  walk(): Promise<Result<FileWalkResult, DataSourceError>>;
  readFile(path: string): Promise<Result<string, DataSourceError>>;
}
