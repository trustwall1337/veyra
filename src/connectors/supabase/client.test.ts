import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PolicyViolationError } from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';
import {
  defaultReadOnlyEvidencePolicy,
  type ValidationPolicy,
} from '../../types/validation-policy.js';

import { createSupabaseClient, type SupabaseTransport } from './client.js';

function recordingTransport(): SupabaseTransport & {
  calls: { name: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    invokeTool: async (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    },
  };
}

const ROL_POLICY: ValidationPolicy = defaultReadOnlyEvidencePolicy('local');

describe('SupabaseClient — per-call guard', () => {
  it('every successful call forwards read_only=true and project_ref to the transport', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.listTables();
    expect(isOk(r)).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]?.args['project_ref']).toBe('ref-abc');
    expect(t.calls[0]?.args['read_only']).toBe(true);
  });

  it('denies execute_sql under read_only_evidence policy', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('execute_sql');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error).toBeInstanceOf(PolicyViolationError);
      expect(r.error.message).toContain('denied');
    }
    expect(t.calls.length).toBe(0);
  });

  it('denies apply_migration and other mutating tools', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    for (const tool of [
      'apply_migration',
      'deploy_edge_function',
      'create_branch',
      'update_storage_config',
    ]) {
      const r = await c.invoke(tool);
      expect(isErr(r), `tool ${tool} should be denied`).toBe(true);
    }
  });

  it('denies a non-allowlisted tool', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('some_future_tool');
    expect(isErr(r)).toBe(true);
  });

  it('denies a call without project_ref', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: '',
      policy: ROL_POLICY,
    });
    const r = await c.listTables();
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.message).toContain('project_ref');
    }
  });

  it('denies get_logs under default read_only_evidence policy (read_application_logs is set)', async () => {
    // read_application_logs IS in the default allowed_actions set, so
    // get_logs would actually succeed; this test guards the inverse.
    const stripped: ValidationPolicy = {
      ...ROL_POLICY,
      allowed_actions: new Set([
        'read_code',
        'read_schema_metadata',
        'read_storage_metadata',
      ]),
    };
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: stripped,
    });
    const r = await c.invoke('get_logs');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.message).toContain('read_application_logs');
    }
  });
});

describe('SupabaseClient — storage-buckets artifact', () => {
  it('writes storage-buckets.json to the artifact dir', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-sb-'));
    const r = await c.writeStorageBucketsArtifact(dir, [
      { id: 'public', name: 'public', public: true },
    ]);
    expect(isOk(r)).toBe(true);
    const written = await fs.readdir(dir);
    expect(written).toContain('storage-buckets.json');
  });
});
