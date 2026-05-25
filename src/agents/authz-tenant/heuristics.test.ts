/**
 * Unit tests for the legacy heuristics module.
 *
 * After retro-11b the runtime agent path is fact-driven (see
 * `agent.test.ts`). The heuristics module is retained as a regex
 * reference for future Pass-2 hypothesis attachment by AI Inference;
 * these tests preserve the regex behaviour so a future consumer can
 * rely on it.
 */

import { describe, expect, it } from 'vitest';

import { detectAuthzIssues } from './heuristics.js';

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
