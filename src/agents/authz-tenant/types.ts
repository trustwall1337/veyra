export interface AuthzTenantInput {
  readonly projectRoot: string;
  readonly scanFactsArtifactPath?: string;
  readonly supabaseTablesArtifactPath?: string;
  /** Pre-08b name; superseded by scanFactsArtifactPath. Kept for back-compat. */
  readonly scannerFindingsArtifactPath?: string;
}

export interface AuthzTenantOutput {
  readonly findingsCount: number;
  readonly factsConsumed: number;
}
