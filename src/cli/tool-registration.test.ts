import { describe, expect, it } from 'vitest';

import { createToolRegistry } from '../core/tools/registry.js';
import { asToolId } from '../core/tools/tool-id.js';
import {
  type LovableTransport,
  createLovableClient,
} from '../connectors/lovable/client.js';
import {
  type SupabaseTransport,
  createSupabaseClient,
} from '../connectors/supabase/client.js';
import { SUPABASE_ALLOWLIST, checkInvocation } from '../connectors/supabase/policy.js';
import { buildGitleaksArgs } from '../scanners/gitleaks/adapter.js';
import { isErr, isOk } from '../types/result.js';
import { defaultReadOnlyEvidencePolicy } from '../types/validation-policy.js';

import { registerReadOnlyTools } from './tool-registration.js';

const POLICY = defaultReadOnlyEvidencePolicy('dev');

function spyTransport(): {
  transport: SupabaseTransport;
  calls: { tool: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { tool: string; args: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    transport: {
      invokeTool: async (tool, args) => {
        calls.push({ tool, args });
        return { ok: true };
      },
    },
  };
}

const lovableTransport: LovableTransport = {
  invokeTool: async () => ({ ok: true }),
};

function buildRegistry() {
  const reg = createToolRegistry();
  const spy = spyTransport();
  const supabaseClient = createSupabaseClient({
    transport: spy.transport,
    projectRef: 'proj-1',
    policy: POLICY,
  });
  const lovableClient = createLovableClient({
    transport: lovableTransport,
    projectId: 'p1',
  });
  registerReadOnlyTools(reg, {
    rulesPath: '/bundled/rules',
    supabaseClient,
    lovableClient,
  });
  return { reg, spy };
}

describe('tool registration — read-only catalog (Step 33)', () => {
  it('(a) registers no generic call-mcp descriptor', () => {
    const { reg } = buildRegistry();
    const ids = reg.descriptors().map((d) => String(d.tool_id));
    expect(ids.some((id) => /call.?mcp/i.test(id))).toBe(false);
  });

  it('(b) has no descriptor for execute_sql or any denied method', () => {
    const { reg } = buildRegistry();
    const ids = new Set(reg.descriptors().map((d) => String(d.tool_id)));
    for (const denied of [
      'execute-sql',
      'execute_sql',
      'apply-migration',
      'deploy-edge-function',
    ]) {
      expect(ids.has(denied)).toBe(false);
    }
    // The allowlist itself excludes execute_sql, so it has no descriptor.
    expect(SUPABASE_ALLOWLIST.some((e) => e.tool === 'execute_sql')).toBe(false);
  });

  it('(b) Supabase descriptor universe is exactly the allowlist size', () => {
    const { reg } = buildRegistry();
    // read-schema-meta + read-storage-meta are the two semantic renames.
    const ids = new Set(reg.descriptors().map((d) => String(d.tool_id)));
    expect(ids.has('read-schema-meta')).toBe(true);
    expect(ids.has('read-storage-meta')).toBe(true);
    // One supabase tool per allowlist entry (count check, allowlist-derived).
    // Key off `source_module` (resolved via the full descriptor — the view does
    // not expose it) so a future title tweak cannot silently break the
    // mechanical-derivation guarantee.
    const supabaseToolCount = reg
      .descriptors()
      .filter(
        (d) =>
          reg.resolve(d.tool_id)?.source_module ===
          'src/connectors/supabase/tools/index.ts',
      ).length;
    expect(supabaseToolCount).toBe(SUPABASE_ALLOWLIST.length);
  });

  it('(c) invoke-time denial still fires for execute_sql (defense-in-depth)', () => {
    const denied = checkInvocation('execute_sql', 'proj-1', POLICY);
    expect(isErr(denied)).toBe(true);
  });

  it('(c) a Supabase read tool injects read_only=true + project_ref', async () => {
    const { reg, spy } = buildRegistry();
    const tool = reg.resolve(asTool('read-schema-meta'));
    expect(tool).toBeDefined();
    const r = await tool?.invoke(
      {},
      { scanId: 's1', projectPath: '/tmp/p' },
      POLICY,
    );
    expect(r !== undefined && isOk(r)).toBe(true);
    const call = spy.calls.at(-1);
    expect(call?.tool).toBe('list_tables');
    expect(call?.args.read_only).toBe(true);
    expect(call?.args.project_ref).toBe('proj-1');
  });

  it('(d) gitleaks hard-binds --redact (not an args field)', () => {
    expect(buildGitleaksArgs({ projectPath: '/x' })).toContain('--redact');
    const { reg } = buildRegistry();
    const tool = reg.resolve(asTool('run-gitleaks'));
    // The args schema accepts no `redact` field — redaction is not toggleable.
    const parsed = tool?.args_schema.safeParse({ redact: false });
    // z.object({}) strips unknown keys; the parsed value carries no redact.
    expect(parsed?.success).toBe(true);
    expect((parsed?.success ? parsed.data : {}) as Record<string, unknown>).not.toHaveProperty(
      'redact',
    );
  });
});

function asTool(id: string) {
  const r = asToolId(id);
  if (!r.ok) throw new Error(`bad id ${id}`);
  return r.value;
}
