export interface AuthnInput {
  /** Absolute path to the project root (retained for context only). */
  readonly projectRoot: string;
  /**
   * Path to `scan-facts.json` (post-08b). The agent's Pass-1
   * predicates consume facts from this artifact; absence triggers
   * coverage_gap findings rather than a file walk.
   */
  readonly scanFactsArtifactPath?: string;
  /** @deprecated Pre-08b name; superseded by scanFactsArtifactPath. */
  readonly scannerFindingsArtifactPath?: string;
}

export interface AuthnOutput {
  readonly findingsCount: number;
  readonly factsConsumed: number;
}
