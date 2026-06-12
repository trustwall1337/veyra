import { describe, expect, it } from 'vitest';

import type { LedgerGap } from './required-evidence-ledger.js';
import { runClassificationPredicates } from './floor.js';

describe('runClassificationPredicates — deterministic floor (Step 35 + 35b)', () => {
  it('emits one coverage_gap per ledger gap (Step 35 contract)', () => {
    const gaps: LedgerGap[] = [
      { baseline_item_id: 'scanner_secrets_run', gap_control_id: 'cc-11-7' },
      { baseline_item_id: 'schema_meta_read', gap_control_id: 'cc-11-5' },
    ];
    const findings = runClassificationPredicates([], gaps);
    // Step 35b: predicates also run; with empty facts, some predicates emit
    // their own coverage_gap (e.g. predicatePublicBucket → cc-11-12). The
    // Step-35 contract is "every ledger gap is present in the output" —
    // assert that, not the total length.
    const ledgerControlIds = findings
      .filter((f) => f.id.startsWith('coverage-gap-'))
      .map((f) => f.control_id)
      .sort();
    expect(ledgerControlIds).toEqual(
      expect.arrayContaining(['cc-11-5', 'cc-11-7']),
    );
    for (const f of findings.filter((x) => x.id.startsWith('coverage-gap-'))) {
      expect(f.finding_type).toBe('coverage_gap');
    }
  });

  it('with empty input, predicates may still emit coverage_gaps for absent evidence sources (Step 35b)', () => {
    // Step 35b: predicates that signal "missing observation" on empty input
    // (e.g. predicatePublicBucket for cc-11-12 when no storage source is
    // wired) fire here as well. This is the correct behaviour — the floor's
    // job is to produce a coverage_gap whenever a required source is absent.
    const findings = runClassificationPredicates([], []);
    // Every emitted finding must be a coverage_gap on empty input — nothing
    // else can legitimately fire without facts.
    for (const f of findings) {
      expect(f.finding_type).toBe('coverage_gap');
    }
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
