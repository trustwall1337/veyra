import type { ArtifactRef } from './artifact.js';
import type { Finding } from './finding.js';

// Runtime context types live in `agent-context.ts` — split from this file in
// Step 35 so the policy/executor type chain (consumed by scanner adapters) does
// NOT transitively reach `Finding`. Re-exported here for backward compatibility.
export type { AgentExecutionContext, AgentLogger } from './agent-context.js';

export interface AgentMetadata {
  readonly id: string;
  readonly version: string;
  /**
   * What this agent needs to be present before it runs. Entries can
   * be either:
   *  - an agent id (resolves directly to that agent), or
   *  - an artifact basename (resolves to whichever registered agent
   *    declares the artifact in `produces`).
   *
   * The special value `'*'` means "depend on every other registered
   * agent" — used by report/aggregation agents that consume all
   * upstream findings.
   */
  readonly declared_dependencies: readonly string[];
  /**
   * Artifact basenames this agent writes to its execution context's
   * `artifactDir`. Used by the orchestrator's topological sort to
   * resolve artifact-name dependencies declared by other agents.
   */
  readonly produces?: readonly string[];
}

export type AgentStatus = 'completed' | 'skipped' | 'failed';

export interface AgentResult<O> {
  readonly status: AgentStatus;
  readonly output?: O;
  readonly artifacts: readonly ArtifactRef[];
  readonly findings: readonly Finding[];
  readonly warnings: readonly string[];
}

export interface VeyraAgent<I, O> {
  // Imported via the re-export above so this module's types still resolve.
  readonly metadata: AgentMetadata;
  run(
    input: I,
    context: import('./agent-context.js').AgentExecutionContext,
  ): Promise<AgentResult<O>>;
}
