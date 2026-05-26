/**
 * Step 2.07 drift-guard tests.
 *
 * §12 catalog-drift: filename is advisory; the test's exported
 * `controlId` constant is the drift authority.
 *  - Drift guard A: every catalog file's `controlId` exists in
 *    `controls.ts`.
 *  - Drift guard B: every Phase-2-active-supported `control_id` in
 *    `controls.ts` has a corresponding catalog entry whose
 *    `controlId` matches.
 */

import { describe, expect, it } from 'vitest';

import { CONTROLS } from '../../evidence-report/controls.js';

import { ALL_ENTRIES, getCatalogControlIds } from './index.js';

const PHASE2_ACTIVE_CONTROL_IDS = [
  'cc-11-1',
  'cc-11-2',
  'cc-11-3',
  'cc-11-4',
  'cc-11-5',
  'cc-11-6',
  'cc-11-9',
  'cc-11-12',
] as const;

describe('Negative-test catalog drift guard A', () => {
  it('every catalog entry`s controlId exists in controls.ts', () => {
    const known = new Set(CONTROLS.map((c) => c.control_id));
    for (const entry of ALL_ENTRIES) {
      expect(known.has(entry.controlId)).toBe(true);
    }
  });
});

describe('Negative-test catalog drift guard B', () => {
  it('every Phase-2-active-supported control_id has a catalog entry', () => {
    const catalogIds = new Set(getCatalogControlIds());
    for (const id of PHASE2_ACTIVE_CONTROL_IDS) {
      expect(catalogIds.has(id)).toBe(true);
    }
  });

  it('ships exactly the eight Phase 2 active-validation catalog entries', () => {
    expect(ALL_ENTRIES.length).toBe(PHASE2_ACTIVE_CONTROL_IDS.length);
  });
});

describe('Negative-test catalog — every entry has the required exports', () => {
  it('every entry exposes controlId + run + expected_outcomes_on_fixture', () => {
    for (const entry of ALL_ENTRIES) {
      expect(typeof entry.controlId).toBe('string');
      expect(typeof entry.run).toBe('function');
      expect(entry.expected_outcomes_on_fixture).toBeDefined();
    }
  });
});
