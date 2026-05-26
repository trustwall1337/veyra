import { describe, expect, it } from 'vitest';

import type { Finding } from '../../types/finding.js';

import { proposeTestsFromFindings } from './agent-active-integration.js';

const finding = (control_id: string, finding_type: 'likely_issue' | 'coverage_gap' | 'confirmed_issue'): Finding => ({
  id: `f-${control_id}`,
  control_id,
  finding_type,
  evidence_strength: 'medium',
  reproducibility: 'mcp_context',
  review_action: 'review_before_launch',
  blast_radius: 'tenant_data',
  title: `${control_id} ${finding_type}`,
  summary: 's',
  evidence_refs: [],
});

describe('proposeTestsFromFindings (codex retro 2.10-no-agent-integration)', () => {
  it('proposes an active test for each likely_issue finding', () => {
    const tests = proposeTestsFromFindings('supabase-rls', [
      finding('cc-11-5', 'likely_issue'),
      finding('cc-11-6', 'likely_issue'),
    ]);
    expect(tests.length).toBe(2);
    expect(tests[0]?.expected_outcome_hint).toBe('proven_allowed');
  });

  it('proposes a test for coverage_gap findings (no outcome hint)', () => {
    const tests = proposeTestsFromFindings('supabase-rls', [
      finding('cc-11-5', 'coverage_gap'),
    ]);
    expect(tests.length).toBe(1);
    expect(tests[0]?.expected_outcome_hint).toBeUndefined();
  });

  it('does NOT propose tests for confirmed_issue findings', () => {
    const tests = proposeTestsFromFindings('supabase-rls', [
      finding('cc-11-5', 'confirmed_issue'),
    ]);
    expect(tests.length).toBe(0);
  });

  it('deduplicates per control_id', () => {
    const tests = proposeTestsFromFindings('supabase-rls', [
      finding('cc-11-5', 'likely_issue'),
      finding('cc-11-5', 'coverage_gap'),
    ]);
    expect(tests.length).toBe(1);
  });
});
