import { describe, expect, it } from 'vitest';

import { HypothesisRegistry } from './registry.js';
import { briefingDigest } from '../briefing/persist.js';
import type { HypothesisId } from './types.js';

function fixedClock(): () => number {
  return () => Date.parse('2026-06-12T08:00:00.000Z');
}

describe('HypothesisRegistry — V1 monotonic id minting', () => {
  it('mints deterministic hyp_NNNNNN ids in insertion order', () => {
    const reg = new HypothesisRegistry({ now: fixedClock() });
    const a = reg.propose({ statement: 's1', confidence: 'low' });
    const b = reg.propose({ statement: 's2', confidence: 'medium' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.hypothesis_id).toBe('hyp_000001');
      expect(b.value.hypothesis_id).toBe('hyp_000002');
    }
  });

  it('two fresh registry instances produce identical id sequences', () => {
    const r1 = new HypothesisRegistry({ now: fixedClock() });
    const r2 = new HypothesisRegistry({ now: fixedClock() });
    const a1 = r1.propose({ statement: 's', confidence: 'low' });
    const a2 = r2.propose({ statement: 's', confidence: 'low' });
    expect(a1.ok && a2.ok).toBe(true);
    if (a1.ok && a2.ok) {
      expect(a1.value.hypothesis_id).toBe(a2.value.hypothesis_id);
    }
  });

  it('clear() resets the counter so a reused registry starts at hyp_000001 again', () => {
    const reg = new HypothesisRegistry({ now: fixedClock() });
    reg.propose({ statement: 'x', confidence: 'low' });
    reg.clear();
    const a = reg.propose({ statement: 'y', confidence: 'low' });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.hypothesis_id).toBe('hyp_000001');
  });
});

describe('HypothesisRegistry — V5 update rejects unknown id', () => {
  it('returns Result.err and does not mutate', () => {
    const reg = new HypothesisRegistry({ now: fixedClock() });
    const before = reg.snapshot();
    const r = reg.update('hyp_does_not_exist' as HypothesisId, {
      disposition: 'partially_evidenced',
    });
    expect(r.ok).toBe(false);
    expect(reg.snapshot()).toEqual(before);
  });
});

describe('HypothesisRegistry — disposition transitions + counts', () => {
  it('countByDisposition reflects mixed states', () => {
    const reg = new HypothesisRegistry({ now: fixedClock() });
    const a = reg.propose({ statement: 'a', confidence: 'low' });
    const b = reg.propose({ statement: 'b', confidence: 'medium' });
    const c = reg.propose({ statement: 'c', confidence: 'high' });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    reg.update(b.value.hypothesis_id, {
      disposition: 'partially_evidenced',
      step_refs: [3],
    });
    reg.update(c.value.hypothesis_id, {
      disposition: 'evidenced_against',
      step_refs: [4],
    });
    const counts = reg.countByDisposition();
    expect(counts).toEqual({
      proposed: 1,
      partially_evidenced: 1,
      evidenced_against: 1,
      superseded: 0,
    });
  });
});

describe('briefingDigest sibling — V1/V4 determinism contract proxy', () => {
  it('the briefing digest is stable (sanity check that 40d V1/V4 still hold)', () => {
    const a = briefingDigest({
      purpose: { value: 'p', confidence: 'low' },
      user_roles: { value: [], confidence: 'low' },
      data_kinds: { value: [], confidence: 'low' },
      auth_model: { value: 'a', confidence: 'low' },
      sensitive_tables: { value: [], confidence: 'low' },
      dependency_surface: { framework: 'vite', key_deps: [], confidence: 'low' },
      observed_trust_boundaries: { value: [], confidence: 'low' },
      synthesis_mode: 'structural_only',
      recorded_at: '2026-06-12T00:00:00.000Z',
    });
    const b = briefingDigest({
      purpose: { value: 'p', confidence: 'low' },
      user_roles: { value: [], confidence: 'low' },
      data_kinds: { value: [], confidence: 'low' },
      auth_model: { value: 'a', confidence: 'low' },
      sensitive_tables: { value: [], confidence: 'low' },
      dependency_surface: { framework: 'vite', key_deps: [], confidence: 'low' },
      observed_trust_boundaries: { value: [], confidence: 'low' },
      synthesis_mode: 'structural_only',
      recorded_at: '2099-01-01T00:00:00.000Z',
    });
    expect(a).toBe(b);
  });
});
