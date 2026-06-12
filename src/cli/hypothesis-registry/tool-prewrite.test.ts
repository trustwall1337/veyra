import { describe, expect, it } from 'vitest';

import { HypothesisRegistry } from './registry.js';
import { createProposeHypothesisTool } from './tools/propose-hypothesis/tool.js';
import { createUpdateHypothesisTool } from './tools/update-hypothesis/tool.js';
import type { HypothesisId } from './types.js';

import type { ValidationPolicy } from '../../types/validation-policy.js';

/**
 * V4 + V4b + V5 + V5b + V6 (prewrite half) tool-level tests for the
 * propose / update hypothesis descriptors.
 */

function fixedNow(): () => number {
  return () => Date.parse('2026-06-12T08:00:00.000Z');
}

function stubPolicy(): ValidationPolicy {
  return {
    mode: 'read_only_evidence',
    environment: 'local',
    allowed_actions: new Set(['read_code', 'author_hypothesis']),
    forbidden_actions: new Set(),
    approval: { required: false },
  };
}

const context = { scanId: 'sc-test', projectPath: '/tmp/p' };

describe('V4 — propose-hypothesis Layer-2 prewrite guard catches scalar smuggling', () => {
  it('rejects when statement contains a classification token', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const tool = createProposeHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    const r = await tool.invoke(
      {
        statement: 'I think finding_type is at risk here',
        confidence: 'medium',
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(false);
    expect(reg.snapshot()).toEqual([]);
  });

  it('rejects when statement contains a claim-vocab token (V6 prewrite)', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const tool = createProposeHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    for (const token of [
      'secure',
      'safe',
      'compliant',
      'vulnerable',
      'exploit',
      'launch-blocker',
      'confirmed',
      'proven_X',
    ]) {
      const r = await tool.invoke(
        { statement: `this looks ${token}`, confidence: 'medium' },
        context,
        stubPolicy(),
      );
      expect(r.ok).toBe(false);
    }
    expect(reg.snapshot()).toEqual([]);
  });

  it('rejects when statement contains a token nested in a benign-looking field structure', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const tool = createProposeHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    // V4b: even when args structurally satisfy the schema (statement is a
    // string), the recursive containsClassificationKey walk catches a key
    // sneaking in via `control_id_hint` carrying a classification key
    // token in its VALUE. The scalar-string walker catches it.
    const r = await tool.invoke(
      {
        statement: 'fine prose here',
        confidence: 'low',
        control_id_hint: 'finding_type-something',
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(false);
    expect(reg.snapshot()).toEqual([]);
  });

  it('accepts a benign hypothesis', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const tool = createProposeHypothesisTool({
      registry: reg,
      redactor: (raw) => `[REDACTED]${raw}`,
      isAcceptedStepRef: () => true,
    });
    const r = await tool.invoke(
      {
        statement: 'observed multi-tenant model with shared sessions table',
        confidence: 'medium',
        control_id_hint: 'cc-11-3',
        briefing_field_ref: 'sensitive_tables',
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Decision L: empty facts
      expect(r.value.facts).toEqual([]);
    }
    const snapshot = reg.snapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.statement).toContain('[REDACTED]');
    expect(snapshot[0]?.disposition).toBe('proposed');
  });
});

describe('V5 + V5b — update-hypothesis grounding', () => {
  it('V5: unknown hypothesis_id → Result.err, registry untouched', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    const before = reg.snapshot();
    const r = await tool.invoke(
      {
        hypothesis_id: 'hyp_does_not_exist',
        disposition: 'partially_evidenced',
        step_refs: [7],
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(false);
    expect(reg.snapshot()).toEqual(before);
  });

  it('V5b(a): partially_evidenced with empty step_refs → reject', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const proposed = reg.propose({ statement: 'p', confidence: 'low' });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    const r = await tool.invoke(
      {
        hypothesis_id: proposed.value.hypothesis_id,
        disposition: 'partially_evidenced',
        step_refs: [],
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(false);
    expect(reg.snapshot()[0]?.disposition).toBe('proposed');
  });

  it('V5b(b): evidenced_against with unknown step_ref → reject', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const proposed = reg.propose({ statement: 'p', confidence: 'low' });
    if (!proposed.ok) return;
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      // Decision M: the predicate rejects seq=999
      isAcceptedStepRef: (seq) => seq === 7 || seq === 11,
    });
    const r = await tool.invoke(
      {
        hypothesis_id: proposed.value.hypothesis_id,
        disposition: 'evidenced_against',
        step_refs: [999],
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(false);
    expect(reg.snapshot()[0]?.disposition).toBe('proposed');
  });

  it('V5b(c): evidenced_against with accepted step_ref → ok, mutated', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const proposed = reg.propose({ statement: 'p', confidence: 'low' });
    if (!proposed.ok) return;
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: (seq) => seq === 7,
    });
    const r = await tool.invoke(
      {
        hypothesis_id: proposed.value.hypothesis_id,
        disposition: 'evidenced_against',
        step_refs: [7],
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(true);
    expect(reg.snapshot()[0]?.disposition).toBe('evidenced_against');
  });

  it('V5b(d): superseded does NOT require step_refs', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const proposed = reg.propose({ statement: 'p', confidence: 'low' });
    if (!proposed.ok) return;
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => false, // would fail step_ref check if it ran
    });
    const r = await tool.invoke(
      {
        hypothesis_id: proposed.value.hypothesis_id,
        disposition: 'superseded',
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(true);
    expect(reg.snapshot()[0]?.disposition).toBe('superseded');
  });

  it('update-hypothesis returns empty facts (Decision L)', async () => {
    const reg = new HypothesisRegistry({ now: fixedNow() });
    const proposed = reg.propose({ statement: 'p', confidence: 'low' });
    if (!proposed.ok) return;
    const tool = createUpdateHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });
    const r = await tool.invoke(
      {
        hypothesis_id: proposed.value.hypothesis_id,
        disposition: 'superseded',
      },
      context,
      stubPolicy(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.facts).toEqual([]);
  });
});

describe('V15 — propose-hypothesis carries the right metadata fields', () => {
  it('mints id + proposed_at via injected now', async () => {
    const reg = new HypothesisRegistry({
      now: () => Date.parse('2026-06-12T08:00:00.000Z'),
    });
    const tool = createProposeHypothesisTool({
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
      modelId: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    });
    await tool.invoke(
      { statement: 's', confidence: 'low' },
      context,
      stubPolicy(),
    );
    const snap = reg.snapshot();
    expect(snap[0]?.hypothesis_id).toBe('hyp_000001' as HypothesisId);
    expect(snap[0]?.proposed_at).toBe('2026-06-12T08:00:00.000Z');
    expect(snap[0]?.model_id).toBe('eu.anthropic.claude-sonnet-4-5-20250929-v1:0');
  });
});
