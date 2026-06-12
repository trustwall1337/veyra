import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXPECTED_PROBE_IDS, PROBE_PRIMITIVE_CATALOG } from './index.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Step 39b V17 — catalog-drift guard (codex 39b-catalog-layout-drift
 * [APPLIED]). Enumerates `cc-11-*.ts` files under
 * `src/agents/sandbox-runner/probe-primitives/` and asserts the
 * registered catalog matches the file inventory exactly.
 */
describe('V17 — probe-primitive catalog drift guard', () => {
  it('PROBE_PRIMITIVE_CATALOG has exactly 12 entries (cc-11-3 + 11 new)', () => {
    expect(PROBE_PRIMITIVE_CATALOG.size).toBe(12);
  });

  it('catalog ids match EXPECTED_PROBE_IDS list', () => {
    expect([...PROBE_PRIMITIVE_CATALOG.keys()].sort()).toEqual(
      [...EXPECTED_PROBE_IDS].sort(),
    );
  });

  it('every cc-11-N.ts file under probe-primitives/ is registered', async () => {
    const entries = await fs.readdir(THIS_DIR);
    const ccFiles = entries
      .filter((f) => /^cc-11-[0-9a-z]+\.ts$/.test(f) && !f.endsWith('.test.ts'))
      .sort();
    expect(ccFiles.length).toBeGreaterThan(0);

    // Each file's control_id is a prefix of the corresponding probe_id.
    const registeredControlIds = new Set(
      [...PROBE_PRIMITIVE_CATALOG.values()].map((p) => p.control_id),
    );
    for (const file of ccFiles) {
      const controlId = file.replace(/\.ts$/, '');
      expect(
        registeredControlIds.has(controlId),
        `file ${file} corresponds to control_id ${controlId}; registered control_ids: ${[...registeredControlIds].join(', ')}`,
      ).toBe(true);
    }
  });
});

/**
 * Step 39b V1 — every probe has a non-empty requestSchema with the
 * required markers (method + urlTemplate fixed; pathParams non-empty
 * for non-fully-fixed probes).
 */
describe('V1 — probe primitives request-schema shape', () => {
  it('every primitive declares method + urlTemplate as fixed', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      expect(p.requestSchema.method.mode).toBe('fixed');
      expect(p.requestSchema.urlTemplate.mode).toBe('fixed');
      expect(typeof p.requestSchema.urlTemplate.value).toBe('string');
    }
  });

  it('every primitive declares non-empty requiredActions', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      expect(p.requiredActions.length).toBeGreaterThan(0);
      expect(p.requiredActions.includes('call_api_with_test_identity')).toBe(true);
    }
  });

  it('every primitive declares cleanup_strategy', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      expect(['audit_only', 'reverse']).toContain(p.cleanup_strategy);
    }
  });

  it('mutating probes declare create_synthetic_record + cleanup_veyra_created_data', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      if (p.cleanup_strategy === 'reverse') {
        expect(p.requiredActions.includes('create_synthetic_record')).toBe(true);
        expect(p.requiredActions.includes('cleanup_veyra_created_data')).toBe(true);
      }
    }
  });

  it('cc-11-13a is fully-fixed (no AI-authored fields)', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-13a-openapi-enumeration');
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(Object.keys(p.requestSchema.pathParams).length).toBe(0);
  });
});
