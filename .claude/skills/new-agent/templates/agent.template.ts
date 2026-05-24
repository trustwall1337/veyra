/**
 * PlaceholderAgent
 *
 * <One-line purpose from PHASE_1_PLAN §4.<N>.>
 *
 * Reads inputs from the artifact store via AgentExecutionContext.
 * Writes outputs as artifacts. Never imports from sibling agents.
 *
 * See PHASE_1_PLAN §4.<N> for the full responsibility list.
 */

import type {
  VeyraAgent,
  AgentExecutionContext,
  AgentResult,
} from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';
import type { PlaceholderInput, PlaceholderOutput } from './types.js';

export class PlaceholderAgentError extends Error {
  override readonly name = 'PlaceholderAgentError';
}

export const placeholderAgent: VeyraAgent<PlaceholderInput, PlaceholderOutput> = {
  id: 'placeholder-agent',
  version: '0.1.0',

  async run(
    input: PlaceholderInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<PlaceholderOutput>> {
    const findings: Finding[] = [];
    const warnings: string[] = [];

    // TODO(phase-1): implement per PHASE_1_PLAN §4.<N>.
    // 1. Read evidence from context.artifactDir (never from sibling agents).
    // 2. Run the agent's checks.
    // 3. Draft findings using the trust-model vocabulary — invoke the
    //    write-finding skill for each one.
    // 4. Write any produced artifacts back to context.artifactDir.

    const output: PlaceholderOutput = {
      // TODO: fill per ./types.js PlaceholderOutput shape.
    } as PlaceholderOutput;

    return {
      status: 'completed',
      output,
      artifacts: [],
      findings,
      warnings,
    };
  },
};
