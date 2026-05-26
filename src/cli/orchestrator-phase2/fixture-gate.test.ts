import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { HttpResponse } from '../../agents/sandbox-runner/test-catalog/index.js';

import { runFixtureGate } from './fixture-gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  'examples',
  'vulnerable-lovable-supabase',
  'sandbox-fixture',
);

describe('runFixtureGate (codex retro 2.15-gate-is-shape-only)', () => {
  it('all expected outcomes skip when recordings are absent (current state)', async () => {
    const r = await runFixtureGate({ fixtureDir: FIXTURE_DIR });
    expect(r.matched.length).toBe(0);
    expect(r.mismatched.length).toBe(0);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it('matches expected_outcome when a recording yields the right response', async () => {
    const r = await runFixtureGate({
      fixtureDir: FIXTURE_DIR,
      loadRecording: async (e): Promise<HttpResponse | undefined> => {
        if (e.control_id === 'cc-11-1' && e.variant_id === 'frontend-only') {
          // proven_allowed: 200 with body
          return { status: 200, headers: {}, body: { secret: 'data' }, bodyByteLength: 20 };
        }
        if (e.control_id === 'cc-11-5' && e.variant_id === 'rls-on') {
          // proven_denial: 403
          return { status: 403, headers: {}, body: {}, bodyByteLength: 2 };
        }
        return undefined;
      },
    });
    expect(r.matched.length).toBeGreaterThanOrEqual(2);
    // cc-11-1 frontend-only matches proven_allowed (we returned 200+body)
    expect(r.matched.find((e) => e.control_id === 'cc-11-1')).toBeDefined();
    // cc-11-5 rls-on matches proven_denial (we returned 403)
    expect(r.matched.find((e) => e.control_id === 'cc-11-5' && e.variant_id === 'rls-on')).toBeDefined();
  });

  it('reports mismatched outcomes', async () => {
    const r = await runFixtureGate({
      fixtureDir: FIXTURE_DIR,
      loadRecording: async (e): Promise<HttpResponse | undefined> => {
        if (e.control_id === 'cc-11-1' && e.variant_id === 'frontend-only') {
          // Expected proven_allowed; we return 403 → proven_denial. Mismatch.
          return { status: 403, headers: {}, body: {}, bodyByteLength: 2 };
        }
        return undefined;
      },
    });
    expect(r.mismatched.length).toBe(1);
    expect(r.mismatched[0]?.observed).toBe('proven_denial');
  });
});
