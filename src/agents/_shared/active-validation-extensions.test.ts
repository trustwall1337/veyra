/**
 * Step 2.10a-e shared helpers — unit tests.
 */
import { describe, expect, it } from 'vitest';

import { buildTestPlanEntry, indexResults, promoteFindingType } from './active-validation-extensions.js';

describe('buildTestPlanEntry (step 2.10a-d)', () => {
  it('produces a TestPlanEntry with opaque owning_agent_id', () => {
    const e = buildTestPlanEntry({
      testId: 't-1',
      controlId: 'cc-11-5',
      owningAgentId: 'supabase-rls',
    });
    expect(e.test_id).toBe('t-1');
    expect(e.control_id).toBe('cc-11-5');
    expect(typeof e.owning_agent_id).toBe('string');
    expect(e.required_synthetic_resources).toEqual(['identity']);
    expect(e.max_duration_ms).toBe(30_000);
  });

  it('respects optional resources + outcome hint', () => {
    const e = buildTestPlanEntry({
      testId: 't-2',
      controlId: 'cc-11-9',
      owningAgentId: 'authz-tenant',
      requiredResources: ['identity', 'tenant', 'record'],
      expectedOutcomeHint: 'proven_denial',
      maxDurationMs: 60_000,
    });
    expect(e.required_synthetic_resources).toEqual(['identity', 'tenant', 'record']);
    expect(e.expected_outcome_hint).toBe('proven_denial');
    expect(e.max_duration_ms).toBe(60_000);
  });
});

describe('indexResults (step 2.10e input)', () => {
  it('groups results by control_id', () => {
    const idx = indexResults({
      scan_id: 's-1',
      results: [
        { test_id: 't1', control_id: 'cc-11-5', outcome: 'proven_allowed', evidence_refs: [], duration_ms: 1, synthetic_data_refs: [], assertion_details: {} },
        { test_id: 't2', control_id: 'cc-11-5', outcome: 'proven_denial', evidence_refs: [], duration_ms: 2, synthetic_data_refs: [], assertion_details: {} },
        { test_id: 't3', control_id: 'cc-11-2', outcome: 'inconclusive', evidence_refs: [], duration_ms: 3, synthetic_data_refs: [], assertion_details: {} },
      ],
    });
    expect(idx.byControlId.get('cc-11-5')?.length).toBe(2);
    expect(idx.byControlId.get('cc-11-2')?.length).toBe(1);
    expect(idx.all.length).toBe(3);
  });

  it('tolerates malformed input (returns empty)', () => {
    expect(indexResults(null).all).toEqual([]);
    expect(indexResults('garbage').all).toEqual([]);
    expect(indexResults({ results: 'not-an-array' }).all).toEqual([]);
  });
});

describe('promoteFindingType (step 2.10e §5.2 promotion rule)', () => {
  it('likely_issue + proven_allowed → confirmed_issue', () => {
    const r = promoteFindingType('likely_issue', [
      { test_id: 't1', control_id: 'cc-11-5', outcome: 'proven_allowed', evidence_refs: [], duration_ms: 1, synthetic_data_refs: [], assertion_details: {} },
    ]);
    expect(r.newType).toBe('confirmed_issue');
    expect(r.promotedBy).toBe('proven_allowed');
  });

  it('coverage_gap + proven_allowed → confirmed_issue', () => {
    const r = promoteFindingType('coverage_gap', [
      { test_id: 't1', control_id: 'cc-11-5', outcome: 'proven_allowed', evidence_refs: [], duration_ms: 1, synthetic_data_refs: [], assertion_details: {} },
    ]);
    expect(r.newType).toBe('confirmed_issue');
  });

  it('likely_issue + proven_denial → stays likely_issue (no down-promotion)', () => {
    const r = promoteFindingType('likely_issue', [
      { test_id: 't1', control_id: 'cc-11-5', outcome: 'proven_denial', evidence_refs: [], duration_ms: 1, synthetic_data_refs: [], assertion_details: {} },
    ]);
    expect(r.newType).toBe('likely_issue');
    expect(r.promotedBy).toBeUndefined();
  });

  it('inconclusive only → no promotion', () => {
    const r = promoteFindingType('coverage_gap', [
      { test_id: 't1', control_id: 'cc-11-5', outcome: 'inconclusive', evidence_refs: [], duration_ms: 1, synthetic_data_refs: [], assertion_details: {} },
    ]);
    expect(r.newType).toBe('coverage_gap');
  });
});
