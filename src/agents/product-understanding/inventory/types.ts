/**
 * Types for the deterministic Bootstrap Inventory module.
 *
 * Per AI-shape revision §1 layer 1 + §7.1: this module owns the
 * `observed_evidence` field on `declared-context.json`. AI never
 * writes here. The composer (17c) merges this artifact with the AI's
 * `ai-declared-intent.json` to produce the final `declared-context.json`.
 */

export type DetectedFramework =
  | 'vite'
  | 'next'
  | 'remix'
  | 'plain'
  | 'unknown';

/** Source-record entry for the audit trail. */
export interface InventorySource {
  readonly kind:
    | 'local_file_walk'
    | 'package_json'
    | 'route_extraction'
    | 'framework_detection'
    | 'env_extraction'
    | 'mcp_supabase'
    | 'mcp_lovable';
  readonly description: string;
}

export interface PackageJsonDigest {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

export interface SupabaseSchemaSummary {
  readonly tables: readonly string[];
  readonly schema_present: boolean;
}

export interface InventoryObservedEvidence {
  readonly file_map: readonly string[];
  readonly package_json_digest?: PackageJsonDigest;
  readonly routes: readonly string[];
  readonly framework: DetectedFramework;
  readonly env_declarations: readonly string[];
  readonly supabase_schema?: SupabaseSchemaSummary;
  readonly lovable_files?: readonly string[];
}

export interface InventoryBootstrap {
  readonly observed_evidence: InventoryObservedEvidence;
  readonly sources: readonly InventorySource[];
}

export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';
}
