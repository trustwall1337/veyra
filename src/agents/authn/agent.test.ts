import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { asScannerId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { createAuthnAgent } from './agent.js';

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

function semgrepFact(
  factId: string,
  ruleId: string,
  excerpt = 'sanitized',
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

async function writeScanFacts(dir: string, facts: readonly ScanFact[]): Promise<string> {
  const p = path.join(dir, 'scan-facts.json');
  await fs.writeFile(p, JSON.stringify({ scan_facts: facts }, null, 2));
  return p;
}

describe('authn agent — Pass-1 fact-driven (retro-10b)', () => {
  it('emits cc-11-1 likely_issue on client-side-only-guard Semgrep fact (no server-role-check fact)', async () => {
    const c = await ctx();
    const facts = [semgrepFact('sg-1', 'rules.authz.client-side-only-guard')];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    expect(r.status).toBe('completed');
    const cc1 = r.findings.find((f) => f.control_id === 'cc-11-1');
    expect(cc1).toBeDefined();
    expect(cc1?.finding_type).toBe('likely_issue');
    expect(cc1?.evidence_refs).toContain('sg-1');
  });

  it('emits cc-11-2 likely_issue on admin-route Semgrep fact with no server-role-check fact', async () => {
    const c = await ctx();
    const facts = [semgrepFact('sg-2', 'rules.authz.admin-route')];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    const cc2 = r.findings.find((f) => f.control_id === 'cc-11-2');
    expect(cc2).toBeDefined();
    expect(cc2?.finding_type).toBe('likely_issue');
  });

  it('does NOT emit cc-11-2 when a server-role-check fact is present', async () => {
    const c = await ctx();
    const facts = [
      semgrepFact('sg-3', 'rules.authz.admin-route'),
      semgrepFact('sg-4', 'rules.authz.server-role-check'),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    const cc2 = r.findings.find(
      (f) => f.control_id === 'cc-11-2' && f.finding_type === 'likely_issue',
    );
    expect(cc2).toBeUndefined();
  });

  it('emits per-control coverage_gap when scan-facts.json is missing entirely', async () => {
    const c = await ctx();
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot }, c);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('cc-11-1-coverage-gap-no-scan-facts');
    expect(ids).toContain('cc-11-2-coverage-gap-no-scan-facts');
    for (const f of r.findings) {
      expect(f.finding_type).toBe('coverage_gap');
    }
  });

  it('emits authnCoverageGaps coverage_gap when scan-facts is present but contains no authn rule_ids', async () => {
    const c = await ctx();
    // Semgrep ran but produced unrelated rule matches.
    const facts = [semgrepFact('sg-other', 'rules.misc.something-unrelated')];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    const gaps = r.findings.filter((f) => f.finding_type === 'coverage_gap');
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('NEVER emits confirmed_issue (constraint 10)', async () => {
    const c = await ctx();
    const facts = [
      semgrepFact('sg-5', 'rules.authz.client-side-only-guard'),
      semgrepFact('sg-6', 'rules.authz.admin-route'),
    ];
    const p = await writeScanFacts(c.artifactDir, facts);
    const agent = createAuthnAgent();
    const r = await agent.run({ projectRoot: c.projectRoot, scanFactsArtifactPath: p }, c);
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
  });
});
