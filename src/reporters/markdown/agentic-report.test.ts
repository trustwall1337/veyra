import { describe, expect, it } from 'vitest';

import type { Finding } from '../../types/finding.js';
import { DEFAULT_BUDGET_CAPS } from '../../core/orchestrator/loop-budget.js';

import {
  type LoopTraceSummary,
  renderAgenticReport,
} from './agentic-report.js';

const FORBIDDEN = /\b(secure|securely|safe|safely|compliant|compliance)\b/i;

function trace(overrides: Partial<LoopTraceSummary> = {}): LoopTraceSummary {
  return {
    tools_called: 4,
    denials: 0,
    arg_rejects: 0,
    tool_errors: 0,
    result_rejects: 0,
    subagent_errors: 0,
    budget_consumed: {
      tool_calls: 4,
      steps: 5,
      cost_units: 0,
      elapsed_ms: 1234,
      caps: DEFAULT_BUDGET_CAPS,
    },
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    control_id: 'cc-test',
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'unknown',
    title: 'scanner_secrets_run',
    summary: 'Required evidence missing; needs human review.',
    evidence_refs: [],
    ...overrides,
  };
}

describe('agentic-report renderer (Step 37)', () => {
  it('orders sections: narrative → root-cause → cards → active → gaps → trace (a/b/c)', () => {
    const md = renderAgenticReport({
      narrative_prose: 'Required evidence was missing; needs human review.',
      findings: [finding()],
      ledger_missing: [
        { baseline_item_id: 'scanner_secrets_run', gap_control_id: 'cc-11-7' },
      ],
      trace: trace(),
      narrative_used_fallback: false,
    });
    const idx = (s: string) => md.indexOf(s);
    expect(idx('## Narrative')).toBeGreaterThan(-1);
    expect(idx('## Root-cause synthesis')).toBeGreaterThan(idx('## Narrative'));
    expect(idx('## Per-control cards (audit appendix)')).toBeGreaterThan(
      idx('## Root-cause synthesis'),
    );
    expect(idx('## Active-validation outcomes')).toBeGreaterThan(
      idx('## Per-control cards (audit appendix)'),
    );
    expect(idx('## Coverage gaps')).toBeGreaterThan(idx('## Active-validation outcomes'));
    expect(idx('## Loop-trace summary')).toBeGreaterThan(idx('## Coverage gaps'));
  });

  it('output-language-lint clean — no forbidden trust words (e)', () => {
    const md = renderAgenticReport({
      narrative_prose:
        '12 finding(s) appear launch-blocking and need human review.',
      findings: [
        finding({ review_action: 'fix_before_launch' }),
        finding({ review_action: 'review_before_launch' }),
      ],
      ledger_missing: [],
      trace: trace({ tools_called: 7, denials: 1, result_rejects: 1 }),
      narrative_used_fallback: false,
    });
    expect(FORBIDDEN.test(md)).toBe(false);
  });

  it('renders a fallback marker when the narrative came from the deterministic fallback', () => {
    const md = renderAgenticReport({
      narrative_prose: 'No findings were produced; nothing appears launch-blocking.',
      findings: [],
      ledger_missing: [],
      trace: trace(),
      narrative_used_fallback: true,
    });
    expect(md).toContain(
      'The deterministic fallback narrative is rendered here because the authored narrative could not be lint-cleared.',
    );
  });

  it('surfaces the loop-trace summary fields (c)', () => {
    const md = renderAgenticReport({
      narrative_prose: 'Findings were checked.',
      findings: [],
      ledger_missing: [],
      trace: trace({
        tools_called: 9,
        denials: 2,
        result_rejects: 3,
        subagent_errors: 1,
      }),
      narrative_used_fallback: false,
    });
    expect(md).toContain('tools called: 9');
    expect(md).toContain('denials: 2');
    expect(md).toContain('result-rejects: 3');
    expect(md).toContain('sub-agent errors: 1');
  });
});
