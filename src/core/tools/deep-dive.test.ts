import { describe, expect, it } from 'vitest';

import {
  DEEP_DIVE_SCOPE_ROW_COUNT,
  DEEP_DIVE_SCOPE_TABLE,
  type SpawnDeepDiveProposal,
  scopeForTarget,
  targetDescriptorSchema,
} from './deep-dive.js';

describe('deep-dive scope table (D6 / PLAN §O)', () => {
  it('pins the row count so adding a target kind is a deliberate, CI-visible change', () => {
    expect(Object.keys(DEEP_DIVE_SCOPE_TABLE)).toHaveLength(
      DEEP_DIVE_SCOPE_ROW_COUNT,
    );
  });

  it('gives every target kind a non-empty action scope (actions, not tool ids)', () => {
    for (const scope of Object.values(DEEP_DIVE_SCOPE_TABLE)) {
      expect(scope.allowed_actions.length).toBeGreaterThan(0);
      expect(scope.summary.length).toBeGreaterThan(0);
    }
  });

  it('resolves a target to its deterministic table scope, not an AI-chosen one', () => {
    const parsed = targetDescriptorSchema.safeParse({
      kind: 'suspected_idor',
      subject: 'fact:endpoint-7',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const proposal: SpawnDeepDiveProposal = {
      kind: 'spawn_deep_dive',
      target_descriptor: parsed.data,
    };
    const scope = scopeForTarget(proposal.target_descriptor);
    expect(scope).toBe(DEEP_DIVE_SCOPE_TABLE.suspected_idor);
    expect(scope.allowed_actions).toContain('verify_denial');
  });
});

describe('targetDescriptorSchema — closed, no free text (PLAN §O)', () => {
  it('accepts a valid target with an opaque subject ref', () => {
    expect(
      targetDescriptorSchema.safeParse({
        kind: 'rls_policy_graph',
        subject: 'fact:table-users',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown target kind', () => {
    expect(
      targetDescriptorSchema.safeParse({ kind: 'nope', subject: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an extra free-text field (strict, no free text)', () => {
    expect(
      targetDescriptorSchema.safeParse({
        kind: 'suspected_idor',
        subject: 'fact:endpoint-7',
        focus: 'arbitrary AI prose',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing or empty subject ref', () => {
    expect(
      targetDescriptorSchema.safeParse({ kind: 'suspected_idor' }).success,
    ).toBe(false);
    expect(
      targetDescriptorSchema.safeParse({ kind: 'suspected_idor', subject: '' })
        .success,
    ).toBe(false);
  });
});
