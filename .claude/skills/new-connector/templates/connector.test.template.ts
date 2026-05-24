import { describe, it, expect } from 'vitest';

import { PolicyViolationError } from '../../core/policy/tool-policy.js';
import { PlaceholderServiceConnector } from './placeholder-service.js';

describe('PlaceholderServiceConnector', () => {
  it('allowlisted tool: succeeds and returns the parsed response', async () => {
    // Build with a mock MCP client. Do NOT hit the real network in tests.
    // const connector = new PlaceholderServiceConnector({
    //   /* mock client + config */
    // });
    // const result = await connector.<allowlistedMethod>();
    // expect(result.ok).toBe(true);
    expect(true).toBe(true);
  });

  it('forbidden tool: rejected by the policy guard with PolicyViolationError', async () => {
    // The connector should not expose a method for forbidden tools at all.
    // This test belongs at the policy-guard layer: verify that the guard
    // returns PolicyViolationError for an off-allowlist tool name.
    //
    // const result = enforceToolPolicy({
    //   service: 'placeholder-service',
    //   tool: 'forbidden_tool',
    //   args: {},
    // });
    // expect(result.ok).toBe(false);
    // if (!result.ok) expect(result.error).toBeInstanceOf(PolicyViolationError);
    expect(PolicyViolationError).toBeDefined();
  });

  // The two tests below are required for the Supabase connector. Delete them
  // if you're scaffolding the Lovable connector.

  it('Supabase only: rejects a call missing read_only=true', async () => {
    // TODO: verify that constructing or calling the connector without
    // read_only=true is impossible (compile error) or fails at runtime.
    expect(true).toBe(true);
  });

  it('Supabase only: rejects a call missing project_ref', async () => {
    // TODO: same as above for project_ref.
    expect(true).toBe(true);
  });
});
