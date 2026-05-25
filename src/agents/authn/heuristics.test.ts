/**
 * Unit tests for the legacy heuristics module.
 *
 * After retro-10b the runtime agent path is fact-driven (see
 * `agent.test.ts`). The heuristics module is retained as a regex
 * reference for future Pass-2 hypothesis attachment by AI Inference;
 * these tests preserve the regex behaviour so a future consumer can
 * rely on it.
 */

import { describe, expect, it } from 'vitest';

import { detectAuthnIssues } from './heuristics.js';

describe('detectAuthnIssues — cc-11-1 client-side guard', () => {
  it('flags an if (!user) navigate(...) pattern', () => {
    const r = detectAuthnIssues({
      fileList: [
        {
          filePath: 'src/App.tsx',
          content: 'if (!user) navigate("/login");',
        },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe('cc-11-1');
  });

  it('flags res.data.user variant', () => {
    const r = detectAuthnIssues({
      fileList: [
        {
          filePath: 'src/App.tsx',
          content: 'if (!res.data.user) { navigate("/login"); }',
        },
      ],
    });
    expect(r.find((f) => f.kind === 'cc-11-1')).toBeDefined();
  });
});

describe('detectAuthnIssues — cc-11-2 admin without role check', () => {
  it('flags <Route path="/admin" /> when no server-side role check exists', () => {
    const r = detectAuthnIssues({
      fileList: [
        {
          filePath: 'src/App.tsx',
          content: '<Route path="/admin" element={<AdminPage />} />',
        },
      ],
    });
    expect(r.find((f) => f.kind === 'cc-11-2')).toBeDefined();
  });

  it('does NOT flag admin route when project contains a role-check pattern', () => {
    const r = detectAuthnIssues({
      fileList: [
        {
          filePath: 'src/App.tsx',
          content: '<Route path="/admin" />',
        },
        {
          filePath: 'src/lib/auth.ts',
          content: 'export function requireRole(role: "admin") { ... }',
        },
      ],
    });
    expect(r.find((f) => f.kind === 'cc-11-2')).toBeUndefined();
  });
});
