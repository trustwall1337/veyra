/**
 * Shared types for the `declared-context.json` artifact.
 *
 * The artifact's two fields have distinct owners (revision §7.1):
 *  - `observed_evidence` — deterministic Bootstrap Inventory (17b)
 *  - `declared_intent`   — AI Product-Understanding agent (17c)
 *
 * The composer in `src/core/declared-context/` merges both into the
 * final artifact with field-by-owner enforcement. These types live in
 * `src/types/` so both the agent layer and the core composer can name
 * them without crossing the no-cross-layer-imports rule.
 */

export type DetectedFramework =
  | 'vite'
  | 'next'
  | 'remix'
  | 'plain'
  | 'unknown';

export interface PackageJsonDigestShared {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

export interface SupabaseSchemaSummaryShared {
  readonly tables: readonly string[];
  readonly schema_present: boolean;
}

export interface ObservedEvidence {
  readonly file_map: readonly string[];
  readonly package_json_digest?: PackageJsonDigestShared;
  readonly routes: readonly string[];
  readonly framework: DetectedFramework;
  readonly env_declarations: readonly string[];
  readonly supabase_schema?: SupabaseSchemaSummaryShared;
  readonly lovable_files?: readonly string[];
}

export interface ConfidenceTaggedString {
  readonly value: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes?: string;
}

export interface ConfidenceTaggedStringList {
  readonly value: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes?: string;
}

export interface DeclaredIntent {
  readonly purpose?: ConfidenceTaggedString;
  readonly user_roles?: ConfidenceTaggedStringList;
  readonly data_kinds?: ConfidenceTaggedStringList;
  readonly auth_model?: ConfidenceTaggedString;
}
