import { describe, expect, it } from 'vitest';

import { asAnalyzerId } from '../../types/identity.js';
import {
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';
import type { ProposedScanPlan, ProposedScanPlanEntry } from '../../types/scan-plan.js';

import { compile, MANDATORY_BASELINE_CONTROL_IDS } from './active-validation-policy-compiler.js';

function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function modeBPolicy() {
  const r = defaultSandboxActiveValidationPolicy('sandbox');
  if (!r.ok) throw r.error;
  return r.value;
}

function proposed(entries: ProposedScanPlanEntry[]): ProposedScanPlan {
  return {
    scan_id: 'compile-scan-1',
    producer_id: analyzerId('ai-security-planner'),
    entries,
    generated_at: '2026-05-26T00:00:00Z',
  };
}

describe('compile — compile-rejects-out-of-allowed-actions', () => {
  it('rejects synthetic-data entry under read_only_evidence policy', () => {
    const plan = proposed([
      {
        test_id: 't1',
        control_id: 'cc-11-5',
        priority: 'high',
        parameters: { target: { kind: 'table', ref: 'public.orders' } },
        justification: 'test',
      },
    ]);
    const r = compile({
      proposed: plan,
      policy: defaultReadOnlyEvidencePolicy('local'),
      knownTables: ['public.orders'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.rejected_entries[0]?.reason).toContain('denies required actions');
    }
  });
});

describe('compile — compile-injects-missing-baseline (constraint 6, post-codex-retro stricter)', () => {
  it('injects baselines that CAN be injected; rejects when any baseline cannot be injected (post-codex-retro 2.07c)', () => {
    // Plan omits cc-11-2 / cc-11-5 / cc-11-9 (all mandatory baseline).
    // Plan includes only cc-11-1 to show the compiler injects without
    // erasing what was provided. Per codex-retro 2.07c, the compiler
    // now refuses to silently skip baselines that fail prerequisites
    // — cc-11-5 + cc-11-9 require a target table the fallback entry
    // doesn't supply, so compilation surfaces those as err.
    const plan = proposed([
      {
        test_id: 't-cc-11-1',
        control_id: 'cc-11-1',
        priority: 'medium',
        parameters: {},
        justification: 'unauth route check',
      },
    ]);
    const r = compile({
      proposed: plan,
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
    });
    expect(r.ok).toBe(false); // post-retro: strict
    if (!r.ok) {
      // Must surface the specific baselines that couldn't be injected.
      const reasons = r.error.rejected_entries.map((re) => re.reason).join('\n');
      expect(reasons).toContain('cc-11-5');
      expect(reasons).toContain('cc-11-9');
    }
  });

  it('compiles cleanly when ALL mandatory baselines can be injected', () => {
    // Provide the table that cc-11-5 and cc-11-9 baselines need via
    // deterministicBaselineEntries with explicit targets.
    const plan = proposed([
      {
        test_id: 't-cc-11-1',
        control_id: 'cc-11-1',
        priority: 'medium',
        parameters: {},
        justification: 'unauth route check',
      },
    ]);
    const r = compile({
      proposed: plan,
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
      deterministicBaselineEntries: {
        'cc-11-5': {
          test_id: 'cc-11-5-baseline-injected',
          control_id: 'cc-11-5',
          priority: 'medium',
          parameters: { target: { kind: 'table', ref: 'public.orders' } },
          justification: 'baseline',
        },
        'cc-11-9': {
          test_id: 'cc-11-9-baseline-injected',
          control_id: 'cc-11-9',
          priority: 'medium',
          parameters: { target: { kind: 'table', ref: 'public.orders' } },
          justification: 'baseline',
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ids = r.value.entries.map((e) => e.control_id);
      for (const id of ['cc-11-1', 'cc-11-2', 'cc-11-5', 'cc-11-9']) {
        expect(ids).toContain(id);
      }
    }
  });
});

describe('compile — compile-rejects-unknown-target', () => {
  it('rejects an entry pointing at a table that is not in knownTables', () => {
    const plan = proposed([
      {
        test_id: 't1',
        control_id: 'cc-11-5',
        priority: 'high',
        parameters: { target: { kind: 'table', ref: 'public.does_not_exist' } },
        justification: 'test',
      },
    ]);
    const r = compile({
      proposed: plan,
      policy: modeBPolicy(),
      knownTables: ['public.orders'], // does NOT include the requested table
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.rejected_entries[0]?.reason).toContain('not in known schema');
    }
  });
});

describe('compile — per-scan budget cap', () => {
  it('rejects entries once max_identities is exhausted', () => {
    const entries: ProposedScanPlanEntry[] = Array.from({ length: 5 }).map(
      (_, i) => ({
        test_id: `t-${String(i)}`,
        control_id: 'cc-11-5',
        priority: 'medium',
        parameters: { target: { kind: 'table', ref: 'public.orders' } },
        justification: 'budget test',
      }),
    );
    const r = compile({
      proposed: proposed(entries),
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
      syntheticDataPolicy: {
        namespace_prefix: 'veyra-test-',
        max_identities: 2,
        max_tenants: 5,
        max_records: 5,
        max_lifetime_seconds: 600,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const overBudget = r.error.rejected_entries.filter((e) =>
        e.reason.includes('identity budget exhausted'),
      );
      expect(overBudget.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('passes when entries fit under the identity budget (with full baseline injection)', () => {
    const r = compile({
      proposed: proposed([
        {
          test_id: 't-1',
          control_id: 'cc-11-5',
          priority: 'medium',
          parameters: { target: { kind: 'table', ref: 'public.orders' } },
          justification: 'fits',
        },
      ]),
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
      syntheticDataPolicy: {
        namespace_prefix: 'veyra-test-',
        max_identities: 5,
        max_tenants: 5,
        max_records: 5,
        max_lifetime_seconds: 600,
      },
      deterministicBaselineEntries: {
        'cc-11-9': {
          test_id: 'cc-11-9-baseline',
          control_id: 'cc-11-9',
          priority: 'medium',
          parameters: { target: { kind: 'table', ref: 'public.orders' } },
          justification: 'baseline',
        },
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe('compile — producer-agnostic', () => {
  it('deterministic-fallback plan compiles identically to AI plan', () => {
    const aiPlan = proposed([
      {
        test_id: 't-1',
        control_id: 'cc-11-1',
        priority: 'medium',
        parameters: {},
        justification: 'AI',
      },
    ]);
    const detPlan: ProposedScanPlan = {
      ...aiPlan,
      producer_id: analyzerId('deterministic-fallback'),
    };
    const baselines = {
      'cc-11-5': {
        test_id: 'cc-11-5-baseline',
        control_id: 'cc-11-5',
        priority: 'medium' as const,
        parameters: { target: { kind: 'table', ref: 'public.orders' } },
        justification: 'baseline',
      },
      'cc-11-9': {
        test_id: 'cc-11-9-baseline',
        control_id: 'cc-11-9',
        priority: 'medium' as const,
        parameters: { target: { kind: 'table', ref: 'public.orders' } },
        justification: 'baseline',
      },
    };
    const a = compile({
      proposed: aiPlan,
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
      deterministicBaselineEntries: baselines,
    });
    const b = compile({
      proposed: detPlan,
      policy: modeBPolicy(),
      knownTables: ['public.orders'],
      deterministicBaselineEntries: baselines,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.entries.length).toBe(b.value.entries.length);
    }
  });
});

describe('compile — sanity: mandatory baselines are exported', () => {
  it('MANDATORY_BASELINE_CONTROL_IDS is non-empty and well-formed', () => {
    expect(MANDATORY_BASELINE_CONTROL_IDS.length).toBeGreaterThan(0);
  });
});
