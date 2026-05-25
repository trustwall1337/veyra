import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { createAuthzTenantAgent } from './agent.js';
import { detectAuthzIssues } from './heuristics.js';

function recordingLogger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-authz-'));
  return {
    scanId: 'test',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: recordingLogger(),
  };
}

describe('detectAuthzIssues — cc-11-3 direct-object-access', () => {
  it('flags .from("orders").select(...).eq("id", param) without tenant/user filter', () => {
    const matches = detectAuthzIssues({
      fileList: [
        {
          filePath: 'src/pages/OrderPage.tsx',
          content:
            "supabase.from('orders').select('*').eq('id', orderId).single();",
        },
      ],
    });
    expect(matches.find((m) => m.kind === 'cc-11-3')).toBeDefined();
  });

  it('does NOT flag when the query also filters by user_id', () => {
    const matches = detectAuthzIssues({
      fileList: [
        {
          filePath: 'src/pages/OrderPage.tsx',
          content:
            "supabase.from('orders').select('*').eq('id', orderId).eq('user_id', user.id);",
        },
      ],
    });
    expect(matches.find((m) => m.kind === 'cc-11-3')).toBeUndefined();
  });

  it('does NOT flag on a non-sensitive table', () => {
    const matches = detectAuthzIssues({
      fileList: [
        {
          filePath: 'src/lookup.ts',
          content:
            "supabase.from('timezones').select('*').eq('id', tzId);",
        },
      ],
    });
    expect(matches.find((m) => m.kind === 'cc-11-3')).toBeUndefined();
  });
});

describe('detectAuthzIssues — cc-11-4 client-provided tenant scope', () => {
  it('flags params.get("tenant_id") usage', () => {
    const matches = detectAuthzIssues({
      fileList: [
        {
          filePath: 'src/pages/DashboardPage.tsx',
          content: `const tenantId = params.get('tenant_id');
supabase.from('documents').select('*').eq('tenant_id', tenantId);`,
        },
      ],
    });
    expect(matches.find((m) => m.kind === 'cc-11-4')).toBeDefined();
  });
});

describe('authz-tenant agent — integration with vulnerable fixture', () => {
  it('produces cc-11-3 and cc-11-4 findings from the fixture sources', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    // Plant a supabase-tables.json that lists `orders` and `documents`.
    const tables = path.join(c.artifactDir, 'supabase-tables.json');
    await fs.writeFile(
      tables,
      JSON.stringify({
        tables: [
          { name: 'orders' },
          { name: 'documents' },
          { name: 'timezones' },
        ],
      }),
    );
    const agent = createAuthzTenantAgent();
    const r = await agent.run(
      { projectRoot: fixtureRoot, supabaseTablesArtifactPath: tables },
      c,
    );
    expect(r.status).toBe('completed');
    const ids = r.findings.map((f) => f.control_id);
    expect(ids).toContain('cc-11-3');
    expect(ids).toContain('cc-11-4');
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
  });

  it('emits coverage_gap when supabase-tables.json is missing', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: fixtureRoot }, c);
    const gap = r.findings.find((f) => f.finding_type === 'coverage_gap');
    expect(gap).toBeDefined();
  });
});
