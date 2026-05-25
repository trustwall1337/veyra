export interface AuthzTenantInput {
  readonly projectRoot: string;
  readonly supabaseTablesArtifactPath?: string;
  readonly scannerFindingsArtifactPath?: string;
}

export interface AuthzTenantOutput {
  readonly findingsCount: number;
  readonly filesScanned: number;
}
