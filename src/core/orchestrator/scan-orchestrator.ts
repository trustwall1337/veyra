import type {
  AgentExecutionContext,
  VeyraAgent,
} from '../../types/agent.js';

/**
 * Phase 1 step 02 — skeleton only. Real wiring (topological sort, dependency
 * resolution, per-agent try-boundary, retry policy) lands in step 18. This
 * file exists so that types and module-load order are settled before any
 * agent imports it.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

export interface ScanOrchestrator {
  register<I, O>(agent: VeyraAgent<I, O>): void;
  run(context: AgentExecutionContext): Promise<void>;
}

export function createScanOrchestrator(): ScanOrchestrator {
  const agents: VeyraAgent<unknown, unknown>[] = [];
  return {
    register(agent) {
      agents.push(agent as VeyraAgent<unknown, unknown>);
    },
    async run(_context) {
      throw new NotImplementedError(
        `ScanOrchestrator.run is a step-02 skeleton (${agents.length} agent(s) registered); full wiring lands in step 18`,
      );
    },
  };
}
