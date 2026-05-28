import { describe, expect, it } from 'vitest';

import {
  type SpawnDeepDiveProposal,
  targetDescriptorSchema,
} from '../tools/deep-dive.js';
import {
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';

import {
  DEEP_DIVE_DEPTH_CAP,
  authorizeSpawn,
} from './spawn-gate.js';

const READ_ONLY = defaultReadOnlyEvidencePolicy('dev');
const ACTIVE = (() => {
  const r = defaultSandboxActiveValidationPolicy('dev');
  if (!r.ok) throw new Error('expected sandbox policy');
  return r.value;
})();

function rlsTarget(): SpawnDeepDiveProposal {
  const parsed = targetDescriptorSchema.safeParse({
    kind: 'rls_policy_graph',
    subject: 'fact:table-users',
  });
  if (!parsed.success) throw new Error('test target should parse');
  return { kind: 'spawn_deep_dive', target_descriptor: parsed.data };
}

describe('authorizeSpawn — depth cap (Verification a)', () => {
  it('depth cap = 1', () => {
    expect(DEEP_DIVE_DEPTH_CAP).toBe(1);
  });

  it('allows spawn at depth 0', () => {
    const d = authorizeSpawn({ proposal: rlsTarget(), policy: READ_ONLY, depth: 0 });
    expect(d.allowed).toBe(true);
  });

  it('denies spawn at depth 1 with reason depth_cap', () => {
    const d = authorizeSpawn({ proposal: rlsTarget(), policy: READ_ONLY, depth: 1 });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('depth_cap');
  });

  it('denies spawn at depth 2 with reason depth_cap', () => {
    const d = authorizeSpawn({ proposal: rlsTarget(), policy: READ_ONLY, depth: 2 });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('depth_cap');
  });
});

describe('authorizeSpawn — typed target', () => {
  it('rejects an invalid target_descriptor (defense-in-depth)', () => {
    const bad: SpawnDeepDiveProposal = {
      kind: 'spawn_deep_dive',
      // Bypass the typed schema for a runtime-only test of the gate's
      // defense-in-depth re-validation.
      target_descriptor: { kind: 'frobnicate', subject: 'x' } as unknown as SpawnDeepDiveProposal['target_descriptor'],
    };
    const d = authorizeSpawn({ proposal: bad, policy: READ_ONLY, depth: 0 });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('invalid_target');
  });
});

describe('authorizeSpawn — policy admits at least one action', () => {
  it('denies when the policy admits NONE of the target-scope actions', () => {
    // suspected_idor requires active actions; read-only policy admits none.
    const idor: SpawnDeepDiveProposal = {
      kind: 'spawn_deep_dive',
      target_descriptor: targetDescriptorSchema.parse({
        kind: 'suspected_idor',
        subject: 'fact:endpoint',
      }),
    };
    const d = authorizeSpawn({ proposal: idor, policy: READ_ONLY, depth: 0 });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('policy_forbids_actions');
  });

  it('allows suspected_idor under an active policy', () => {
    const idor: SpawnDeepDiveProposal = {
      kind: 'spawn_deep_dive',
      target_descriptor: targetDescriptorSchema.parse({
        kind: 'suspected_idor',
        subject: 'fact:endpoint',
      }),
    };
    const d = authorizeSpawn({ proposal: idor, policy: ACTIVE, depth: 0 });
    expect(d.allowed).toBe(true);
  });
});
