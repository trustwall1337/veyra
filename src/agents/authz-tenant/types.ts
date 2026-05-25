export interface AuthzTenantInput {
  readonly projectRoot: string;
  readonly scanFactsArtifactPath?: string;
  readonly supabaseTablesArtifactPath?: string;
  /** @deprecated Pre-08b name; superseded by scanFactsArtifactPath. */
  readonly scannerFindingsArtifactPath?: string;
}

export interface AuthzTenantOutput {
  readonly findingsCount: number;
  readonly factsConsumed: number;
}
