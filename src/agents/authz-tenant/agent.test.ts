import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { asScannerId, asParserId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { createAuthzTenantAgent } from './agent.js';

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

function semgrepFact(
  factId: string,
  ruleId: string,
  excerpt: string,
): ScanFact {
  const sid = asScannerId('semgrep');
  if (!sid.ok) throw sid.error;
  return {
    fact_id: factId,
    source: {
      kind: 'scanner_match',
      scanner_id: sid.value,
      payload: {
        rule_id: ruleId,
        sanitized_excerpt: excerpt,
        content_kind: 'text',
      },
    },
    file_path: 'src/x.ts',
    line: 1,
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

function tableFact(factId: string, name: string): ScanFact {
  const pid = asParserId('supabase-schema');
  if (!pid.ok) throw pid.error;
  return {
    fact_id: factId,
    source: {
      kind: 'schema_element',
      parser_id: pid.value,
      element_kind: 'table',
      name,
    },
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

async function writeScanFacts(dir: string, facts: readonly ScanFact[]): Promise<string> {
  const p = path.join(dir, 'scan-facts.json');
  await fs.writeFile(p, JSON.stringify({ scan_facts: facts }, null, 2));
  return p;
}

describe('authz-tenant agent — Pass-1 fact-driven (retro-11b)', () => {
  it('emits cc-11-3 likely_issue when direct-object Semgrep fact AND schema_element table fact corroborate', async () => {
    const c = await ctx();
    const facts = [
      semgrepFact(
        'sg-1',
        'rules.authz.direct-object-access-by-id',
        "supabase.from('orders').select('*').eq('id', orderId)",
      ),
      tableFact('tf-orders', 'public.orders'),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    expect(r.status).toBe('completed');
    const cc113 = r.findings.find((f) => f.id === 'cc-11-3-sg-1');
    expect(cc113).toBeDefined();
    expect(cc113?.finding_type).toBe('likely_issue');
    expect(cc113?.evidence_refs).toEqual(['sg-1', 'tf-orders']);
  });

  it('falls back to coverage_gap when Semgrep direct-object fires WITHOUT schema corroboration', async () => {
    const c = await ctx();
    // Semgrep matched but excerpt has no recognizable table name and
    // no schema_element table fact exists.
    const facts = [
      semgrepFact(
        'sg-orphan',
        'rules.authz.direct-object-access-by-id',
        'someOpaqueQueryHelper(orderId)',
      ),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    const gap = r.findings.find((f) => f.id === 'cc-11-3-coverage-gap-sg-orphan');
    expect(gap).toBeDefined();
    expect(gap?.finding_type).toBe('coverage_gap');
  });

  it('emits cc-11-4 on client-tenant Semgrep rule', async () => {
    const c = await ctx();
    const facts = [
      semgrepFact(
        'sg-2',
        'rules.authz.client-tenant-id',
        "supabase.from('documents').eq('tenant_id', params.get('tenant_id'))",
      ),
      tableFact('tf-documents', 'public.documents'),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    const ids = r.findings.map((f) => f.control_id);
    expect(ids).toContain('cc-11-4');
  });

  it('emits per-control coverage_gap when scan-facts.json is missing entirely', async () => {
    const c = await ctx();
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: c.projectRoot }, c);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('cc-11-3-coverage-gap-no-scan-facts');
    expect(ids).toContain('cc-11-4-coverage-gap-no-scan-facts');
    expect(ids).toContain('cc-11-9-coverage-gap-no-scan-facts');
    for (const f of r.findings) {
      expect(f.finding_type).toBe('coverage_gap');
    }
  });

  it('NEVER emits confirmed_issue (constraint 10)', async () => {
    const c = await ctx();
    const facts = [
      semgrepFact(
        'sg-3',
        'rules.authz.direct-object-access-by-id',
        "supabase.from('orders').select('*').eq('id', orderId)",
      ),
      tableFact('tf-orders', 'public.orders'),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthzTenantAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
  });
});
