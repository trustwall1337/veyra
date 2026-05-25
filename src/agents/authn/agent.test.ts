import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { createAuthnAgent } from './agent.js';
import { detectAuthnIssues } from './heuristics.js';

function recordingLogger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-authn-'));
  return {
    scanId: 'test',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: recordingLogger(),
  };
}

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

describe('authn agent — integration with vulnerable fixture', () => {
  it('produces cc-11-1 and cc-11-2 findings from the fixture sources', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    const agent = createAuthnAgent();
    const tempArtifact = path.join(c.artifactDir, 'scanner-findings.json');
    await fs.writeFile(
      tempArtifact,
      JSON.stringify([
        {
          rule_id: 'authn.client-side-only-guard',
          file_path: 'src/App.tsx',
          line: 22,
        },
      ]),
    );
    const r = await agent.run(
      { projectRoot: fixtureRoot, scannerFindingsArtifactPath: tempArtifact },
      c,
    );
    expect(r.status).toBe('completed');
    const ids = r.findings.map((f) => f.control_id);
    expect(ids).toContain('cc-11-1');
    expect(ids).toContain('cc-11-2');
    // No confirmed_issue findings.
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
    // cc-11-1 finding cites the Semgrep ref we planted.
    const cc1 = r.findings.find((f) => f.control_id === 'cc-11-1');
    expect(cc1?.evidence_refs.length ?? 0).toBeGreaterThan(0);
  });

  it('emits coverage_gap when scanner-findings.json is absent', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const c = await ctx();
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: fixtureRoot }, c);
    const gaps = r.findings.filter((f) => f.finding_type === 'coverage_gap');
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });
});
