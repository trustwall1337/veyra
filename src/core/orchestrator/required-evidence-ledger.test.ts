import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ToolResult } from '../../types/tool-result.js';
import {
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';

import { ArtifactState } from './artifact-state.js';
import {
  LEDGER_ARTIFACTS,
  LEDGER_ROW_COUNT,
  LEDGER_TOOL_IDS,
  RequiredEvidenceLedger,
} from './required-evidence-ledger.js';

const modeA = defaultReadOnlyEvidencePolicy('dev');
function modeB() {
  const r = defaultSandboxActiveValidationPolicy('dev');
  if (!r.ok) throw new Error('expected a sandbox policy');
  return r.value;
}

async function stateDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-ledger-'));
}

const result = (facts: ToolResult['facts']): ToolResult => ({ facts });

describe('RequiredEvidenceLedger row count (CI-pinned)', () => {
  it('read-only policy yields exactly mode_a rows', () => {
    expect(new RequiredEvidenceLedger(modeA).rowCount()).toBe(
      LEDGER_ROW_COUNT.mode_a,
    );
  });

  it('active policy yields mode_a + mode_b_add rows', () => {
    expect(new RequiredEvidenceLedger(modeB()).rowCount()).toBe(
      LEDGER_ROW_COUNT.mode_a + LEDGER_ROW_COUNT.mode_b_add,
    );
  });

  it('pins the counts at 6 and 2 so a row change trips CI', () => {
    expect(LEDGER_ROW_COUNT.mode_a).toBe(6);
    expect(LEDGER_ROW_COUNT.mode_b_add).toBe(2);
  });
});

describe('RequiredEvidenceLedger satisfaction', () => {
  it('is unsatisfied and lists all rows missing on an empty state', async () => {
    const ledger = new RequiredEvidenceLedger(modeA);
    const state = new ArtifactState({ artifactDir: await stateDir() });
    expect(ledger.baselineSatisfied(state)).toBe(false);
    expect(ledger.missing(state)).toHaveLength(LEDGER_ROW_COUNT.mode_a);
  });

  it('satisfies schema_meta_read only when artifact AND tool success are present', async () => {
    const dir = await stateDir();
    const ledger = new RequiredEvidenceLedger(modeA);
    const state = new ArtifactState({ artifactDir: dir });

    // Tool succeeded but no artifact yet → still missing.
    state.writeToolResult(
      LEDGER_TOOL_IDS.readSchema,
      result([{ name: 'tables', value: 3 }]),
      'd',
      1,
    );
    expect(
      ledger.missing(state).some((g) => g.baseline_item_id === 'schema_meta_read'),
    ).toBe(true);

    // Now the artifact exists too → that row is satisfied.
    await fs.writeFile(
      path.join(dir, LEDGER_ARTIFACTS.databaseMetadata),
      '{}',
      'utf8',
    );
    expect(
      ledger.missing(state).some((g) => g.baseline_item_id === 'schema_meta_read'),
    ).toBe(false);
  });

  it('reports gap_control_id for missing rows (consumed by the floor)', async () => {
    const ledger = new RequiredEvidenceLedger(modeA);
    const state = new ArtifactState({ artifactDir: await stateDir() });
    const gap = ledger.missing(state).find((g) => g.baseline_item_id === 'scanner_secrets_run');
    expect(gap?.gap_control_id).toBe('cc-11-7');
  });
});
