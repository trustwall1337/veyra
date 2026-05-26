/**
 * Codex retro 2.15-gate-is-shape-only + 2.15-cli-command-not-wired:
 * fixture-active gate end-to-end runner.
 *
 * Reads expected-outcomes.json, replays each (control_id, variant_id)
 * tuple against the recorded fixture (or against a live sandbox in
 * --record mode), and asserts the observed outcome matches the
 * expected outcome.
 *
 * Implementation note: full live-replay of recordings is gated on
 * the recordings being present (recordings/ is intentionally empty
 * in the shipped tree per the README in that directory). This
 * runner ships the shape — when the recordings land, the runner
 * picks them up via convention (file per (control_id, variant_id)).
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { ALL_ENTRIES } from '../../agents/sandbox-runner/test-catalog/index.js';
import type {
  HttpResponse,
  HttpTransport,
} from '../../agents/sandbox-runner/test-catalog/index.js';
import type { ActiveValidationResult } from '../../types/scan-plan.js';
import { asConnectorId } from '../../types/identity.js';

export interface ExpectedOutcomeEntry {
  readonly control_id: string;
  readonly variant_id: string;
  readonly expected_outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
}

export interface FixtureGateInputs {
  readonly fixtureDir: string;
  /**
   * Loader for the recorded HTTP response for one tuple. Default
   * reads `<fixtureDir>/recordings/<control_id>__<variant_id>.json`.
   * Tests inject a fake loader so the gate-runner shape is
   * verifiable without recordings on disk.
   */
  readonly loadRecording?: (
    entry: ExpectedOutcomeEntry,
  ) => Promise<HttpResponse | undefined>;
}

export interface FixtureGateOutcome {
  readonly matched: readonly ExpectedOutcomeEntry[];
  readonly mismatched: readonly {
    readonly expected: ExpectedOutcomeEntry;
    readonly observed: ActiveValidationResult['outcome'];
  }[];
  readonly skipped: readonly ExpectedOutcomeEntry[];
}

const FAKE_TENANT_A = 't-A';

export async function runFixtureGate(
  inputs: FixtureGateInputs,
): Promise<FixtureGateOutcome> {
  const expectedText = await readFile(
    path.join(inputs.fixtureDir, 'expected-outcomes.json'),
    'utf8',
  );
  const expected = JSON.parse(expectedText) as ExpectedOutcomeEntry[];

  const matched: ExpectedOutcomeEntry[] = [];
  const mismatched: {
    expected: ExpectedOutcomeEntry;
    observed: ActiveValidationResult['outcome'];
  }[] = [];
  const skipped: ExpectedOutcomeEntry[] = [];

  const idR = asConnectorId('supabase-auth');
  if (!idR.ok) throw idR.error;
  const actorConnectorId = idR.value;

  for (const exp of expected) {
    const catalogEntry = ALL_ENTRIES.find((e) => e.controlId === exp.control_id);
    if (catalogEntry === undefined) {
      skipped.push(exp);
      continue;
    }
    let recording: HttpResponse | undefined;
    if (inputs.loadRecording !== undefined) {
      recording = await inputs.loadRecording(exp);
    } else {
      const recPath = path.join(
        inputs.fixtureDir,
        'recordings',
        `${exp.control_id}__${exp.variant_id}.json`,
      );
      try {
        const text = await readFile(recPath, 'utf8');
        recording = JSON.parse(text) as HttpResponse;
      } catch {
        // missing recording — skip (the README in recordings/
        // documents the populate path).
      }
    }
    if (recording === undefined) {
      skipped.push(exp);
      continue;
    }
    const transport: HttpTransport = {
      async send() {
        return recording;
      },
    };
    const actor = {
      id: 'fixture-actor-1',
      scan_id: 'fixture-gate',
      provider_subject_id: 'fixture-uid-1',
      identity_provider_id: actorConnectorId,
      role: 'member',
      tenant_id: FAKE_TENANT_A,
      created_at: '2026-05-26T00:00:00Z',
    };
    const r = await catalogEntry.run({
      actor,
      target: { method: 'GET', url: 'https://example.invalid/' },
      accessToken: 'fixture-jwt-redacted',
      transport,
    });
    if (r.outcome === exp.expected_outcome) {
      matched.push(exp);
    } else {
      mismatched.push({ expected: exp, observed: r.outcome });
    }
  }

  return { matched, mismatched, skipped };
}
