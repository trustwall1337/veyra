import { describe, it, expect } from 'vitest';

import type { AgentExecutionContext } from '../../types/agent.js';
import { placeholderAgent } from './placeholder-agent.js';
import type { PlaceholderInput } from './types.js';

const buildContext = (
  overrides: Partial<AgentExecutionContext> = {},
): AgentExecutionContext => ({
  scanId: 'test-scan',
  projectRoot: '/tmp/test-project',
  artifactDir: '/tmp/test-artifacts',
  permissions: {} as AgentExecutionContext['permissions'],
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as AgentExecutionContext['logger'],
  ...overrides,
});

describe('placeholderAgent', () => {
  it('happy path: produces expected output for a well-formed input', async () => {
    const input: PlaceholderInput = {} as PlaceholderInput;
    const result = await placeholderAgent.run(input, buildContext());

    expect(result.status).toBe('completed');
    expect(result.findings).toBeDefined();
  });

  it('error path: handles a known invalid input cleanly', async () => {
    const input: PlaceholderInput = {} as PlaceholderInput;
    const result = await placeholderAgent.run(input, buildContext());

    // Per the agent's contract, an invalid input should either:
    //   - return status 'failed' with a typed error, OR
    //   - return status 'completed' with a finding classified as
    //     'missing-evidence' or 'coverage-gap'.
    // Pick the one your agent uses; never throw uncaught.
    expect(['failed', 'completed']).toContain(result.status);
  });

  it('boundary case: behaves correctly at the edge of expected input range', async () => {
    const input: PlaceholderInput = {} as PlaceholderInput;
    const result = await placeholderAgent.run(input, buildContext());

    expect(result.status).not.toBe('failed');
  });
});
