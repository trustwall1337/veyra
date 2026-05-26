/**
 * Step 2.06 unit tests for the synthetic-data-manager agent.
 *
 * Discipline (PHASE_2_PLAN §4.8 / §11.2 / §11.3):
 *  - Synthesize → registry persisted → cleanup → cleanup-proof.json.
 *  - Orphan detection refuses to start when prior synthetic users exist.
 *  - Partial-failure rollback: any synthesize failure deletes all
 *    previously created resources before returning.
 *  - Bounded auto-retry: deleteUser fails on attempts 1+2, succeeds on 3,
 *    scan continues; if all 3 retries fail, confirmed_issue + non-zero exit.
 *
 * Tests inject a fake admin client; no real Supabase Admin call goes
 * out. Live integration test deferred to a Phase 2 release-gate refresh
 * (per Decision 7's recorded-from-real-or-live-opt-in requirement).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';
import type { SupabaseAdminClient } from '../../connectors/supabase/admin/client.js';
import { supabaseAdminConnectorId } from '../../connectors/supabase/admin/client.js';
import { err, ok, type Result } from '../../types/result.js';

import {
  CLEANUP_PROOF_ARTIFACT,
  SYNTHETIC_RESOURCES_ARTIFACT,
  createSyntheticDataManagerAgent,
} from './agent.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-sdm-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function fakeContext() {
  return {
    scanId: 'test-scan-1',
    projectRoot: workdir,
    artifactDir: workdir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

interface FakeAdminConfig {
  readonly initialOrphans?: readonly string[];
  readonly createFails?: ReadonlySet<string>;
  readonly deleteAttempts?: Map<string, number>;
  readonly succeedsAfterAttempts?: number;
}

function fakeAdmin(config: FakeAdminConfig = {}): SupabaseAdminClient {
  const existing = new Map<string, string>(); // uid -> test_id
  const orphans: string[] = [...(config.initialOrphans ?? [])];
  const deleteCounts = config.deleteAttempts ?? new Map<string, number>();
  let nextId = 0;

  return {
    id: supabaseAdminConnectorId,
    projectRef: 'fakeprojectref01',
    async createSyntheticUser(opts) {
      if (
        config.createFails !== undefined &&
        config.createFails.has(opts.metadata?.['test_id'] as string)
      ) {
        return err(new Error(`forced create failure for ${String(opts.metadata?.['test_id'])}`));
      }
      const uid = `synth-uid-${String(nextId++)}`;
      existing.set(uid, opts.metadata?.['test_id'] as string);
      return ok({
        uid,
        ...(opts.email !== undefined ? { email: opts.email } : {}),
      });
    },
    async deleteUser(uid): Promise<Result<void, Error>> {
      const prev = deleteCounts.get(uid) ?? 0;
      deleteCounts.set(uid, prev + 1);
      const required = config.succeedsAfterAttempts ?? 1;
      if (prev + 1 >= required) {
        existing.delete(uid);
        return ok(undefined);
      }
      return err(new Error(`forced delete failure on attempt ${String(prev + 1)} for ${uid}`));
    },
    async getUserById(uid) {
      if (existing.has(uid)) return ok({ id: uid });
      return ok(null);
    },
    async findOrphanedSyntheticUsers() {
      return ok([...orphans]);
    },
  };
}

describe('synthetic-data-manager — happy path', () => {
  it('synthesize → registry → cleanup → cleanup-proof.json with residual_count: 0', async () => {
    const agent = createSyntheticDataManagerAgent();
    const admin = fakeAdmin();
    const ctx = fakeContext();
    const result = await agent.run(
      {
        identities: [
          { test_id: 't1', role: 'authenticated' },
          { test_id: 't2', role: 'authenticated', tenant_id: 'tenant-A' },
          { test_id: 't3', role: 'admin' },
        ],
        admin,
        sleepMs: async () => undefined,
      },
      ctx,
    );
    expect(result.status).toBe('completed');
    expect(result.output?.identities.length).toBe(3);
    expect(result.output?.cleanup_proof.created_count).toBe(3);
    expect(result.output?.cleanup_proof.deleted_count).toBe(3);
    expect(result.output?.cleanup_proof.residual_count).toBe(0);

    // synthetic-resources.json persisted before cleanup
    const resourcesText = await readFile(
      path.join(workdir, SYNTHETIC_RESOURCES_ARTIFACT),
      'utf8',
    );
    const resources = JSON.parse(resourcesText) as {
      scan_id: string;
      identities: { uid: string; test_id: string }[];
    };
    expect(resources.scan_id).toBe('test-scan-1');
    expect(resources.identities.length).toBe(3);

    // cleanup-proof.json shape
    const proofText = await readFile(
      path.join(workdir, CLEANUP_PROOF_ARTIFACT),
      'utf8',
    );
    const proof = JSON.parse(proofText) as Record<string, unknown>;
    expect(proof['residual_count']).toBe(0);
    expect((proof['per_resource_log'] as unknown[]).length).toBe(3);
  });
});

describe('synthetic-data-manager — orphan detection', () => {
  it('refuses to start when prior synthetic users exist (§11.2)', async () => {
    const agent = createSyntheticDataManagerAgent();
    const admin = fakeAdmin({ initialOrphans: ['orphan-uid-1', 'orphan-uid-2'] });
    const ctx = fakeContext();
    const result = await agent.run(
      { identities: [{ test_id: 't1', role: 'authenticated' }], admin, sleepMs: async () => undefined },
      ctx,
    );
    expect(result.status).toBe('failed');
    expect(result.findings[0]?.title).toContain('could not complete');
    expect(result.findings[0]?.summary).toContain('orphan');
  });
});

describe('synthetic-data-manager — partial-failure rollback', () => {
  it('rolls back all previously created resources when synthesize fails mid-stream', async () => {
    const deleteCounts = new Map<string, number>();
    const admin = fakeAdmin({
      createFails: new Set(['t-fail']),
      deleteAttempts: deleteCounts,
    });
    const agent = createSyntheticDataManagerAgent();
    const ctx = fakeContext();
    const result = await agent.run(
      {
        identities: [
          { test_id: 't1', role: 'authenticated' },
          { test_id: 't2', role: 'authenticated' },
          { test_id: 't-fail', role: 'admin' },
          { test_id: 't4', role: 'authenticated' }, // never reached
        ],
        admin,
        sleepMs: async () => undefined,
      },
      ctx,
    );
    expect(result.status).toBe('failed');
    expect(result.warnings[0]).toContain('rolled back');
    // synth-uid-0 and synth-uid-1 should both have been deleted (rolled back)
    expect(deleteCounts.get('synth-uid-0')).toBeGreaterThanOrEqual(1);
    expect(deleteCounts.get('synth-uid-1')).toBeGreaterThanOrEqual(1);
  });
});

describe('synthetic-data-manager — bounded retry (§11.3)', () => {
  it('transient failure: deleteUser fails on attempts 1+2 then succeeds on 3; scan continues', async () => {
    const deleteCounts = new Map<string, number>();
    const admin = fakeAdmin({
      deleteAttempts: deleteCounts,
      succeedsAfterAttempts: 3, // delete succeeds only on the 3rd call
    });
    const agent = createSyntheticDataManagerAgent();
    const ctx = fakeContext();
    const result = await agent.run(
      {
        identities: [{ test_id: 't1', role: 'authenticated' }],
        admin,
        sleepMs: async () => undefined, // skip real backoff
      },
      ctx,
    );
    expect(result.status).toBe('completed');
    expect(result.output?.cleanup_proof.residual_count).toBe(0);
    // The retry log should show 2 retries (initial + 2 retry attempts;
    // succeeds on attempt 3 = 2 retries needed after the initial).
    const log0 = result.output?.cleanup_proof.per_resource_log[0];
    expect(log0?.outcome).toBe('deleted');
    expect(log0?.retries).toBeGreaterThanOrEqual(1);
  });

  it('exhausts 3 retries → confirmed_issue + non-zero status', async () => {
    const admin = fakeAdmin({
      succeedsAfterAttempts: 99, // delete never succeeds
    });
    const agent = createSyntheticDataManagerAgent();
    const ctx = fakeContext();
    const result = await agent.run(
      {
        identities: [{ test_id: 't1', role: 'authenticated' }],
        admin,
        sleepMs: async () => undefined,
      },
      ctx,
    );
    expect(result.status).toBe('failed');
    expect(result.output?.cleanup_proof.residual_count).toBe(1);
    expect(result.findings[0]?.finding_type).toBe('confirmed_issue');
    expect(result.findings[0]?.review_action).toBe('fix_before_launch');
    expect(result.findings[0]?.control_id).toBe('cc-2-06');
  });
});
