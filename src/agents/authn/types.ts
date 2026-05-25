export interface AuthnInput {
  /**
   * Absolute path to the project root to scan for client-side routes
   * and authn patterns.
   */
  readonly projectRoot: string;
  /**
   * Optional path to the tool-runner's `scanner-findings.json`
   * artifact, used to cite Semgrep findings as evidence. When absent,
   * the agent emits coverage_gap for cc-11-1 and cc-11-2.
   */
  readonly scannerFindingsArtifactPath?: string;
}

export interface AuthnOutput {
  readonly findingsCount: number;
  readonly routesScanned: number;
}
