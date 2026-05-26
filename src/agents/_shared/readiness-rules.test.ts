import { describe, expect, it } from 'vitest';

import type { Finding } from '../../types/finding.js';
import type { ActiveValidationResult } from '../../types/scan-plan.js';
import type { CleanupProof } from '../synthetic-data-manager/agent.js';

import { applyReadinessRules, shouldFailOnBlocker } from './readiness-rules.js';

function finding(control_id: string, finding_type: 'likely_issue' | 'coverage_gap' | 'confirmed_issue'): Finding {
  return {
    id: `f-${control_id}-${finding_type}`,
    control_id,
    finding_type,
    evidence_strength: 'medium',
    reproducibility: 'mcp_context',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: `${control_id} ${finding_type}`,
    summary: '',
    evidence_refs: [],
  };
}

function result(control_id: string, outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive', variant_id?: string): ActiveValidationResult {
  return {
    test_id: `t-${control_id}`,
    control_id,
    outcome,
    evidence_refs: [],
    duration_ms: 1,
    synthetic_data_refs: [],
    assertion_details: variant_id !== undefined ? { variant_id } : {},
  };
}

describe('applyReadinessRules — proven_in_sandbox promotion', () => {
  it('likely_issue + proven_allowed → confirmed_issue + fix_before_launch', () => {
    const out = applyReadinessRules({
      findings: [finding('cc-11-5', 'likely_issue')],
      activeResults: [result('cc-11-5', 'proven_allowed')],
    });
    expect(out.updatedFindings[0]?.finding_type).toBe('confirmed_issue');
    expect(out.updatedFindings[0]?.review_action).toBe('fix_before_launch');
  });

  it('coverage_gap + proven_allowed → confirmed_issue', () => {
    const out = applyReadinessRules({
      findings: [finding('cc-11-5', 'coverage_gap')],
      activeResults: [result('cc-11-5', 'proven_allowed')],
    });
    expect(out.updatedFindings[0]?.finding_type).toBe('confirmed_issue');
  });

  it('proven_denial does NOT promote', () => {
    const out = applyReadinessRules({
      findings: [finding('cc-11-5', 'likely_issue')],
      activeResults: [result('cc-11-5', 'proven_denial')],
    });
    expect(out.updatedFindings[0]?.finding_type).toBe('likely_issue');
  });
});

describe('applyReadinessRules — cleanup-proof residual blocker', () => {
  it('residual_count > 0 produces cc-2-06 confirmed_issue + fix_before_launch', () => {
    const cleanupProof: CleanupProof = {
      scan_id: 's-1',
      created_count: 3,
      deleted_count: 1,
      residual_count: 2,
      duration_ms: 100,
      per_resource_log: [],
    };
    const out = applyReadinessRules({
      findings: [],
      cleanupProof,
    });
    expect(out.residualBlocker).toBeDefined();
    expect(out.residualBlocker?.finding_type).toBe('confirmed_issue');
    expect(out.residualBlocker?.review_action).toBe('fix_before_launch');
    expect(out.residualBlocker?.control_id).toBe('cc-2-06');
  });
});

describe('applyReadinessRules — scenario coverage', () => {
  it('cc-11-5 declares rls_on + rls_off; only rls_on result observed → coverage_gap for rls_off', () => {
    const out = applyReadinessRules({
      findings: [],
      activeResults: [result('cc-11-5', 'proven_denial', 'rls_on')],
      requiredScenariosByControlId: new Map([
        ['cc-11-5', ['rls_on', 'rls_off']],
      ]),
    });
    expect(out.scenarioGaps.length).toBe(1);
    expect(out.scenarioGaps[0]?.title).toContain('rls_off');
    expect(out.scenarioGaps[0]?.finding_type).toBe('coverage_gap');
  });
});

describe('shouldFailOnBlocker — --fail-on-blocker policy', () => {
  it('returns true when any finding is confirmed_issue + fix_before_launch', () => {
    const out = applyReadinessRules({
      findings: [finding('cc-11-5', 'likely_issue')],
      activeResults: [result('cc-11-5', 'proven_allowed')],
    });
    expect(shouldFailOnBlocker({ findings: out.updatedFindings }, out)).toBe(true);
  });

  it('returns true when residualBlocker is set', () => {
    const out = applyReadinessRules({
      findings: [],
      cleanupProof: {
        scan_id: 's', created_count: 1, deleted_count: 0, residual_count: 1, duration_ms: 1, per_resource_log: [],
      },
    });
    expect(shouldFailOnBlocker({ findings: [] }, out)).toBe(true);
  });

  it('returns false on a clean scan with only proven_denial results', () => {
    const out = applyReadinessRules({
      findings: [finding('cc-11-5', 'likely_issue')],
      activeResults: [result('cc-11-5', 'proven_denial')],
    });
    expect(shouldFailOnBlocker({ findings: out.updatedFindings }, out)).toBe(false);
  });
});
