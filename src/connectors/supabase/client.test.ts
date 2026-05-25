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

  it('denies get_logs under the actual default read_only_evidence policy (retro-16 f4)', async () => {
    // Per retro-16 f4: read_application_logs is NOT in the default
    // read-only set. get_logs requires explicit policy opt-in.
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('get_logs');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.message).toContain('read_application_logs');
    }
  });
});

describe('SupabaseClient — retro-16 f2 (caller cannot override enforced fields)', () => {
  it('rejects extra.project_ref override', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('list_tables', { project_ref: 'ref-other' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('project_ref');
  });

  it('rejects extra.read_only override', async () => {
    const t = recordingTransport();
    const c = createSupabaseClient({
      transport: t,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('list_tables', { read_only: false });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('read_only');
  });
});

describe('SupabaseClient — retro-16 f8 + f9 (response redaction + transport error)', () => {
  it('redacts secret-like strings from transport responses', async () => {
    const fakeToken =
      's' + 'k' + '-' + 'a' + 'n' + 't' + '-' + 'a'.repeat(40);
    const transport = {
      async invokeTool(): Promise<unknown> {
        return {
          tables: [
            {
              name: 'config',
              description: `default key is ${fakeToken}`,
            },
          ],
        };
      },
    };
    const c = createSupabaseClient({
      transport,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('list_tables');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const json = JSON.stringify(r.value);
      expect(json.includes(fakeToken)).toBe(false);
    }
  });

  it('converts transport exceptions into SupabaseTransportError', async () => {
    const transport = {
      async invokeTool(): Promise<unknown> {
        throw new Error('upstream MCP died');
      },
    };
    const c = createSupabaseClient({
      transport,
      projectRef: 'ref-abc',
      policy: ROL_POLICY,
    });
    const r = await c.invoke('list_tables');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.name).toBe('SupabaseTransportError');
      expect(r.error.message).toContain('upstream MCP died');
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
