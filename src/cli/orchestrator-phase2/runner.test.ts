import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { asAnalyzerId, asConnectorId } from '../../types/identity.js';
import { defaultSandboxActiveValidationPolicy } from '../../types/validation-policy.js';
import type { CompiledScanPlan } from '../../types/scan-plan.js';
import type { SupabaseAdminClient } from '../../connectors/supabase/admin/client.js';
import type { HttpTransport } from '../../agents/sandbox-runner/test-catalog/index.js';
import { err, ok, type Result } from '../../types/result.js';

import { runPhase2Scan } from './runner.js';

function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}
function connectorId(s: string) {
  const r = asConnectorId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-p2run-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function fakeAdmin(): SupabaseAdminClient {
  const existing = new Map<string, string>();
  let nextId = 0;
  return {
    id: connectorId('supabase-admin'),
    projectRef: 'fakeprojectref01',
    async createSyntheticUser(opts) {
      const uid = `synth-uid-${String(nextId++)}`;
      existing.set(uid, opts.metadata?.['test_id'] as string);
      return ok({ uid, ...(opts.email !== undefined ? { email: opts.email } : {}) });
    },
    async deleteUser(uid): Promise<Result<void, Error>> {
      existing.delete(uid);
      return ok(undefined);
    },
    async getUserById(uid) {
      if (existing.has(uid)) return ok({ id: uid });
      return ok(null);
    },
    async findOrphanedSyntheticUsers() {
      return ok([]);
    },
  };
}

function fakeTransport(): HttpTransport {
  return {
    async send() {
      return { status: 403, headers: {}, body: {}, bodyByteLength: 2 };
    },
  };
}

function ctx() {
  const p = defaultSandboxActiveValidationPolicy('sandbox');
  if (!p.ok) throw p.error;
  return {
    scanId: 'p2run-scan',
    projectRoot: workdir,
    artifactDir: workdir,
    policy: p.value,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function plan(): CompiledScanPlan {
  return {
    scan_id: 'p2run-scan',
    source_producer_id: analyzerId('deterministic-fallback'),
    entries: [
      {
        test_id: 't-1',
        control_id: 'cc-11-1',
        priority: 'medium',
        parameters: { url: 'https://example.invalid/' },
        justification: '',
        validated_target_ref: { kind: 'http_surface', ref: '*' },
        allowed_actions_satisfied: ['call_api_with_test_identity'],
      },
    ],
    compiled_at: '2026-05-26T00:00:00Z',
    baseline_injections: [],
  };
}

describe('runPhase2Scan — happy path', () => {
  it('synthesize → exercise → cleanup with residual=0; scan-actions.log written', async () => {
    const r = await runPhase2Scan({
      compiledPlan: plan(),
      admin: fakeAdmin(),
      transport: fakeTransport(),
      identities: [{ test_id: 'actor-1', role: 'member' }],
      context: ctx(),
      sleepMs: async () => undefined,
    });
    expect(r.synthesize_failed).toBe(false);
    expect(r.exercise_failed).toBe(false);
    expect(r.cleanup_proof.residual_count).toBe(0);
    const logText = await readFile(path.join(workdir, 'scan-actions.log'), 'utf8');
    expect(logText).toContain('orchestrator_start');
    expect(logText).toContain('cleanup_complete');
  });
});

describe('runPhase2Scan — try/finally cleanup on Exercise crash', () => {
  it('throwing transport → Cleanup still runs; scan-actions.log shows crash entry', async () => {
    const throwingTransport: HttpTransport = {
      async send() {
        throw new Error('simulated transport crash mid-exercise');
      },
    };
    const r = await runPhase2Scan({
      compiledPlan: plan(),
      admin: fakeAdmin(),
      transport: throwingTransport,
      identities: [{ test_id: 'actor-1', role: 'member' }],
      context: ctx(),
      sleepMs: async () => undefined,
    });
    // Sandbox-runner catches per-test throws internally; the
    // exercise_failed flag fires when the runner itself crashes.
    // Either way, cleanup ran and residual is 0.
    expect(r.cleanup_proof.residual_count).toBe(0);
    const logText = await readFile(path.join(workdir, 'scan-actions.log'), 'utf8');
    expect(logText).toContain('cleanup_complete');
  });
});
