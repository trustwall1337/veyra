/**
 * Supabase RLS agent shapes.
 *
 * Per PHASE_1_PLAN §4.4 / §7 Task 6 and FPP §11 checks 5, 6, 9, 12.
 * Step 09b reshapes this agent into an assertion predicate over ScanFact[];
 * step 09 lands the original agent shape that emits Finding[] directly.
 */

export interface ParsedTable {
  readonly schema: string;
  readonly name: string;
  /** Source line range (1-indexed inclusive). */
  readonly source_range: { readonly start: number; readonly end: number };
  readonly rls_enabled: boolean;
}

export interface ParsedPolicy {
  readonly name: string;
  readonly schema: string;
  readonly table: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  readonly role?: string;
  readonly using_expr?: string;
  readonly with_check_expr?: string;
  readonly source_range: { readonly start: number; readonly end: number };
}

export interface ParsedGrant {
  readonly privileges: readonly string[];
  readonly schema: string;
  readonly table: string;
  readonly role: string;
  readonly source_range: { readonly start: number; readonly end: number };
}

export interface UnparseableBlock {
  readonly source_range: { readonly start: number; readonly end: number };
  readonly reason: string;
  readonly excerpt: string;
}

export interface ParsedSchema {
  readonly tables: readonly ParsedTable[];
  readonly policies: readonly ParsedPolicy[];
  readonly grants: readonly ParsedGrant[];
  readonly unparseable: readonly UnparseableBlock[];
}

/**
 * Step 24: schema source discriminator. The agent's predicates run
 * the same regardless of source; only the upstream read changes.
 *
 *  - `sql_file`: parse a local `schema.sql` exported via `supabase db dump`.
 *  - `mcp`: drive `list_tables` + `get_advisors` + storage bucket calls
 *    via a `SupabaseClient` that already enforces `read_only=true +
 *    project_ref` at its policy gate.
 *
 * When both flags reach the CLI, the registration branch hands the
 * MCP shape here and the report's Sources section names the override
 * decision in allowed-claims language (per CLAUDE.md §Output language).
 */
export interface SupabaseRlsSqlFileSource {
  readonly source: 'sql_file';
  /** Absolute path to the schema SQL exported via supabase db dump. */
  readonly schemaSqlPath: string;
}

export interface SupabaseRlsMcpSource {
  readonly source: 'mcp';
  /**
   * Already-constructed Supabase MCP client. The CLI builds this from
   * `--supabase-mcp <project_ref>` + `SUPABASE_ACCESS_TOKEN` + the
   * active `ValidationPolicy`. The connector's policy gate enforces
   * `read_only=true + project_ref` per call; the agent does NOT
   * weaken that gate.
   */
  readonly client: import('../../connectors/supabase/client.js').SupabaseClient;
  /**
   * Project ref passed only for diagnostics / `args_fingerprint_sha256`
   * derivation in the ScanFacts the agent emits. The token never
   * appears here.
   */
  readonly projectRef: string;
}

/**
 * Step 27: REST-backed Supabase data source. The customer-default
 * path in Phase 1 after step 27. Reads tables + storage metadata via
 * the Supabase Management REST API — no subprocess, no `npx` spawn.
 *
 * RLS policy expressions (USING / WITH CHECK) are NOT exposed via
 * REST; `database.fetchPolicies()` returns `capability_not_exposed`.
 * The agent emits a `coverage_gap` finding rather than silently
 * missing policy-level checks; cc-11-6 / cc-11-9 (policy-body checks)
 * surface as coverage_gap when the REST path is in use.
 */
export interface SupabaseRlsRestSource {
  readonly source: 'rest';
  readonly database: import('../../types/data-sources.js').DatabaseMetadataSource;
  readonly storage?: import('../../types/data-sources.js').StorageMetadataSource;
  /** project_ref for diagnostics / args_fingerprint_sha256. */
  readonly projectRef: string;
}

export type SupabaseRlsSchemaSource =
  | SupabaseRlsSqlFileSource
  | SupabaseRlsMcpSource
  | SupabaseRlsRestSource;

export interface SupabaseRlsInput {
  /** Schema source: a local SQL dump or a live MCP client. */
  readonly schemaSource: SupabaseRlsSchemaSource;
  /**
   * Optional path to the storage-buckets.json artifact (from step 16's
   * Supabase MCP connector). When absent, bucket findings become
   * coverage_gap (or, in the `mcp` source path, the agent calls
   * `client.listStorageBuckets()` + `client.getStorageConfig()` and
   * builds the same fact shape from the MCP response).
   */
  readonly storageBucketsArtifactPath?: string;
  /**
   * Step 23 Bug A: optional path to `inventory-bootstrap.json`. When
   * supplied, the agent reads `observed_evidence.env_declarations`
   * and converts each declaration into a `local_file/env_declaration`
   * ScanFact so the `predicatePrivilegedClientKey` predicate (cc-11-7)
   * can run alongside the schema + bucket predicates. Absent input
   * is silently tolerated — cc-11-7 simply produces no findings.
   */
  readonly inventoryArtifactPath?: string;
}

export interface SupabaseRlsOutput {
  readonly tables: readonly ParsedTable[];
  readonly findingsCount: number;
}

export interface BucketRecord {
  readonly id: string;
  readonly name: string;
  readonly public: boolean;
  readonly policies?: readonly {
    readonly name: string;
    readonly operation: string;
    readonly role: string;
    readonly definition?: string;
  }[];
}
