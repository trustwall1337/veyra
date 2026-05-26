import { describe, expect, it } from 'vitest';

import { asAnalyzerId } from './identity.js';
import type {
  ActiveValidationCompilationError,
  CompiledScanPlan,
  CompiledScanPlanEntry,
  ProposedScanPlan,
  ProposedScanPlanEntry,
  TargetRef,
} from './scan-plan.js';

function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('ProposedScanPlan shape (step 2.02 codex pf2: no agent-name in shared type)', () => {
  it('producer_id is an opaque AnalyzerId (NOT a closed literal union)', () => {
    const p: ProposedScanPlan = {
      scan_id: 'scan-1',
      producer_id: analyzerId('ai-security-planner'),
      entries: [],
      generated_at: '2026-05-26T00:00:00Z',
    };
    expect(typeof p.producer_id).toBe('string');
  });

  it('ProposedScanPlan has NO `generated_by` field (would be FPP §2A drift)', () => {
    type Keys = keyof ProposedScanPlan;
    const _exhaustive: Record<Keys, true> = {
      scan_id: true,
      producer_id: true,
      entries: true,
      generated_at: true,
    };
    for (const k of Object.keys(_exhaustive)) {
      expect(k).not.toBe('generated_by');
    }
  });
});

describe('ProposedScanPlanEntry + CompiledScanPlanEntry', () => {
  it('CompiledScanPlanEntry extends Proposed with validated_target_ref + allowed_actions_satisfied', () => {
    const target: TargetRef = { kind: 'table', ref: 'public.orders' };
    const proposed: ProposedScanPlanEntry = {
      test_id: 't-1',
      control_id: 'cc-11-9',
      priority: 'high',
      parameters: { row_owner: 'attacker' },
      justification: 'verify per-row authenticated check denies cross-tenant read',
    };
    const compiled: CompiledScanPlanEntry = {
      ...proposed,
      validated_target_ref: target,
      allowed_actions_satisfied: ['call_api_with_test_identity', 'verify_denial'],
    };
    expect(compiled.test_id).toBe(proposed.test_id);
    expect(compiled.validated_target_ref.kind).toBe('table');
  });
});

describe('CompiledScanPlan + ActiveValidationCompilationError', () => {
  it('CompiledScanPlan tracks source_producer_id + baseline_injections', () => {
    const cp: CompiledScanPlan = {
      scan_id: 'scan-1',
      source_producer_id: analyzerId('ai-security-planner'),
      entries: [],
      compiled_at: '2026-05-26T00:00:00Z',
      baseline_injections: ['cc-11-5-baseline'],
    };
    expect(cp.baseline_injections).toEqual(['cc-11-5-baseline']);
  });

  it('ActiveValidationCompilationError records rejected entries + missing baselines', () => {
    const err: ActiveValidationCompilationError = {
      rejected_entries: [
        {
          entry: {
            test_id: 't-bad',
            control_id: 'cc-unknown',
            priority: 'medium',
            parameters: {},
            justification: '',
          },
          reason: 'control_id not in catalog',
        },
      ],
      missing_baseline_controls: ['cc-11-5'],
    };
    expect(err.rejected_entries[0]?.reason).toContain('catalog');
  });
});
