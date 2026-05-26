/**
 * Step 2.13 consistency test: every (control_id, variant_id) in
 * expected-outcomes.json references a control_id in controls.ts.
 * Step 2.15's fixture-validation gate reads from this same file.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTROLS } from '../../../src/agents/evidence-report/controls.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface ExpectedOutcomeEntry {
  readonly control_id: string;
  readonly variant_id: string;
  readonly expected_outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
}

async function loadExpectedOutcomes(): Promise<readonly ExpectedOutcomeEntry[]> {
  const text = await readFile(path.join(HERE, 'expected-outcomes.json'), 'utf8');
  return JSON.parse(text) as ExpectedOutcomeEntry[];
}

describe('sandbox-fixture expected-outcomes.json — consistency', () => {
  it('every entry`s control_id exists in controls.ts', async () => {
    const entries = await loadExpectedOutcomes();
    const known = new Set(CONTROLS.map((c) => c.control_id));
    for (const e of entries) {
      expect(known.has(e.control_id)).toBe(true);
    }
  });

  it('every entry has a non-empty variant_id (required even for single-variant controls)', async () => {
    const entries = await loadExpectedOutcomes();
    for (const e of entries) {
      expect(typeof e.variant_id).toBe('string');
      expect(e.variant_id.length).toBeGreaterThan(0);
    }
  });

  it('expected_outcome is one of the three closed literals', async () => {
    const entries = await loadExpectedOutcomes();
    const allowed = new Set(['proven_denial', 'proven_allowed', 'inconclusive']);
    for (const e of entries) {
      expect(allowed.has(e.expected_outcome)).toBe(true);
    }
  });

  it('cc-11-5 has both rls-on and rls-off variants', async () => {
    const entries = await loadExpectedOutcomes();
    const cc115 = entries.filter((e) => e.control_id === 'cc-11-5');
    expect(cc115.map((e) => e.variant_id).sort()).toEqual(['rls-off', 'rls-on']);
  });
});
