import { describe, expect, it } from 'vitest';

import type { LedgerGap } from './required-evidence-ledger.js';
import { runClassificationPredicates } from './floor.js';

describe('runClassificationPredicates — deterministic floor (Step 35)', () => {
  it('emits one coverage_gap per ledger gap', () => {
    const gaps: LedgerGap[] = [
      { baseline_item_id: 'scanner_secrets_run', gap_control_id: 'cc-11-7' },
      { baseline_item_id: 'schema_meta_read', gap_control_id: 'cc-11-5' },
    ];
    const findings = runClassificationPredicates([], gaps);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.finding_type === 'coverage_gap')).toBe(true);
    expect(findings.map((f) => f.control_id).sort()).toEqual(['cc-11-5', 'cc-11-7']);
  });

  it('emits no findings when there are no gaps and no fact-classifiers fire', () => {
    expect(runClassificationPredicates([], [])).toEqual([]);
  });

  it('output is stable for the same input (deterministic)', () => {
    const gaps: LedgerGap[] = [
      { baseline_item_id: 'scanner_deps_run', gap_control_id: 'cc-11-8' },
    ];
    const a = runClassificationPredicates([], gaps);
    const b = runClassificationPredicates([], gaps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
