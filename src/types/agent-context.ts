import type { ValidationPolicy } from './validation-policy.js';

/**
 * The runtime context handed to an agent or to any policy executor. Split out
 * from `agent.ts` (Step 35) so this file imports NO `Finding` — the §D.2(iii)
 * import-graph walk asserts `Finding` is unreachable from any registered tool
 * entrypoint, and scanner adapters reach the policy-executor types through
 * here without dragging in the classification surface.
 */

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
