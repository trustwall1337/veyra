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

export interface SupabaseRlsInput {
  /** Absolute path to the schema SQL exported via supabase db dump. */
  readonly schemaSqlPath: string;
  /**
   * Optional path to the storage-buckets.json artifact (from step 16's
   * Supabase MCP connector). When absent, bucket findings become
   * coverage_gap.
   */
  readonly storageBucketsArtifactPath?: string;
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
