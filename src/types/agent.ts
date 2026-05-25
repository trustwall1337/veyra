import type { ArtifactRef } from './artifact.js';
import type { Finding } from './finding.js';
import type { ValidationPolicy } from './validation-policy.js';

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

export interface AgentLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface AgentExecutionContext {
  readonly scanId: string;
  readonly projectRoot: string;
  readonly artifactDir: string;
  readonly policy: ValidationPolicy;
  readonly logger: AgentLogger;
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
  readonly metadata: AgentMetadata;
  run(input: I, context: AgentExecutionContext): Promise<AgentResult<O>>;
}
