/**
 * Step 2.15 fixture-validation gate — verification-shape test.
 *
 * Per step 2.01 decision 6 (new command, not extension): this gate
 * is structurally separate from the Phase 1 /scan-fixture gate. It
 * runs the Phase 2 active-validation pipeline against the recorded
 * sandbox fixture and asserts each (control_id, variant_id) tuple
 * produces the expected outcome.
 *
 * This test exercises the gate-shape end-to-end against the
 * deterministic fixture path. The recording infrastructure (real
 * sandbox project recordings under `recordings/`) lands as a
 * follow-up alongside the recorder script.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTROLS } from '../agents/evidence-report/controls.js';
import { ALL_ENTRIES } from '../agents/sandbox-runner/test-catalog/index.js';
import { compile } from '../core/policy/active-validation-policy-compiler.js';
import { defaultSandboxActiveValidationPolicy } from '../types/validation-policy.js';
import { asAnalyzerId } from '../types/identity.js';
import type { ProposedScanPlanEntry } from '../types/scan-plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  '..',
  '..',
  'examples',
  'vulnerable-lovable-supabase',
  'sandbox-fixture',
);

interface ExpectedOutcomeEntry {
  readonly control_id: string;
  readonly variant_id: string;
  readonly expected_outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
}

async function loadExpectedOutcomes(): Promise<readonly ExpectedOutcomeEntry[]> {
  const text = await readFile(path.join(FIXTURE_DIR, 'expected-outcomes.json'), 'utf8');
  return JSON.parse(text) as ExpectedOutcomeEntry[];
}

function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('Phase 2 fixture-active gate — shape', () => {
  it('expected-outcomes.json covers every Phase 2 catalog entry', async () => {
    const entries = await loadExpectedOutcomes();
    const expectedControls = new Set(entries.map((e) => e.control_id));
    const catalogControls = new Set(ALL_ENTRIES.map((e) => e.controlId));
    for (const c of catalogControls) {
      expect(expectedControls.has(c)).toBe(true);
    }
  });

  it('compiler accepts a deterministic plan against Mode B policy for every fixture entry', async () => {
    const entries = await loadExpectedOutcomes();
    const policyR = defaultSandboxActiveValidationPolicy('sandbox');
    if (!policyR.ok) throw policyR.error;
    const proposed: ProposedScanPlanEntry[] = entries.map((e) => ({
      test_id: `${e.control_id}-${e.variant_id}`,
      control_id: e.control_id,
      priority: 'medium',
      parameters:
        e.control_id === 'cc-11-1' || e.control_id === 'cc-11-2'
          ? {}
          : { target: { kind: 'table', ref: 'public.orders' } },
      justification: `fixture replay for variant ${e.variant_id}`,
    }));
    const r = compile({
      proposed: {
        scan_id: 'fixture-gate-1',
        producer_id: analyzerId('deterministic-fallback'),
        entries: proposed,
        generated_at: '2026-05-26T00:00:00Z',
      },
      policy: policyR.value,
      knownTables: ['public.orders'],
      knownBuckets: ['user-files'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Every compiled entry has an explicit allowed_actions_satisfied list.
      for (const e of r.value.entries) {
        expect(e.allowed_actions_satisfied.length).toBeGreaterThan(0);
      }
    }
  });

  it('every fixture (control_id, variant_id) tuple is unique', async () => {
    const entries = await loadExpectedOutcomes();
    const tuples = new Set(entries.map((e) => `${e.control_id}::${e.variant_id}`));
    expect(tuples.size).toBe(entries.length);
  });

  it('controls.ts covers every fixture control_id (drift guard)', async () => {
    const entries = await loadExpectedOutcomes();
    const known = new Set(CONTROLS.map((c) => c.control_id));
    for (const e of entries) {
      expect(known.has(e.control_id)).toBe(true);
    }
  });
});
