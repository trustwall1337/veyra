import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { createSupabaseRlsAgent } from './agent.js';
import {
  evaluateBuckets,
  loadBucketsArtifact,
} from './buckets.js';
import { classifyTable } from './heuristics.js';
import { parseSchemaSql } from './parser.js';

function recordingLogger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-rls-'));
  return {
    scanId: 'test-scan',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: recordingLogger(),
  };
}

describe('parseSchemaSql — supported patterns', () => {
  it('detects ALTER TABLE … ENABLE ROW LEVEL SECURITY', () => {
    const sql = `CREATE TABLE public.orders (id uuid);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;`;
    const parsed = parseSchemaSql(sql);
    const orders = parsed.tables.find((t) => t.name === 'orders');
    expect(orders?.rls_enabled).toBe(true);
  });

  it('reports rls_enabled=false when only CREATE TABLE was issued', () => {
    const sql = `CREATE TABLE public.users (id uuid);`;
    const parsed = parseSchemaSql(sql);
    const users = parsed.tables.find((t) => t.name === 'users');
    expect(users?.rls_enabled).toBe(false);
  });

  it('captures CREATE POLICY with FOR/USING/WITH CHECK', () => {
    const sql = `ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_select_anyone ON public.orders
  FOR SELECT
  USING (true);`;
    const parsed = parseSchemaSql(sql);
    const p = parsed.policies[0];
    expect(p?.name).toBe('orders_select_anyone');
    expect(p?.operation).toBe('SELECT');
    expect(p?.using_expr).toBe('true');
  });

  it('captures TO role on CREATE POLICY', () => {
    const sql = `CREATE POLICY documents_select_authed ON public.documents
  FOR SELECT
  TO authenticated
  USING (true);`;
    const parsed = parseSchemaSql(sql);
    expect(parsed.policies[0]?.role).toBe('authenticated');
  });

  it('parses GRANT statements', () => {
    const sql = `GRANT SELECT, INSERT ON public.orders TO authenticated;`;
    const parsed = parseSchemaSql(sql);
    expect(parsed.grants[0]?.role).toBe('authenticated');
    expect(parsed.grants[0]?.privileges).toEqual(['SELECT', 'INSERT']);
  });

  it('flags DO $$ ... $$ blocks as unparseable, never silent', () => {
    const sql = `DO $$
BEGIN
  -- complex
END $$;`;
    const parsed = parseSchemaSql(sql);
    expect(parsed.unparseable.length).toBeGreaterThan(0);
    expect(parsed.unparseable[0]?.reason).toContain('DO');
  });
});

describe('classifyTable — heuristics', () => {
  it('canonical names produce evidence_strength: high', () => {
    for (const n of ['users', 'orders', 'tenants', 'payments']) {
      expect(classifyTable(n).strength).toBe('high');
      expect(classifyTable(n).matched_via).toBe('exact_name');
    }
  });

  it('pattern names (*_secrets, *_pii, …) produce evidence_strength: medium', () => {
    const c = classifyTable('billing_pii');
    expect(c.strength).toBe('medium');
    expect(c.matched_via).toBe('pattern');
  });

  it('unmatched names report matched_via: none', () => {
    expect(classifyTable('timezones').matched_via).toBe('none');
    expect(classifyTable('feature_flags').matched_via).toBe('none');
  });
});

describe('evaluateBuckets', () => {
  it('emits coverage_gap when storage-buckets.json is absent', () => {
    const r = evaluateBuckets(undefined);
    expect(r.artifact_present).toBe(false);
    expect(r.findings[0]?.finding_type).toBe('coverage_gap');
    expect(r.findings[0]?.control_id).toBe('cc-11-12');
  });

  it('emits likely_issue for a public bucket with anon SELECT', () => {
    const r = evaluateBuckets([
      {
        id: 'user-uploads',
        name: 'user-uploads',
        public: true,
        policies: [
          { name: 'p', operation: 'SELECT', role: 'anon' },
        ],
      },
    ]);
    expect(r.findings[0]?.finding_type).toBe('likely_issue');
    expect(r.findings[0]?.control_id).toBe('cc-11-12');
  });

  it('does NOT emit a finding for a private bucket scoped to service_role', () => {
    const r = evaluateBuckets([
      {
        id: 'internal',
        name: 'internal',
        public: false,
        policies: [{ name: 'p', operation: 'ALL', role: 'service_role' }],
      },
    ]);
    expect(r.findings).toHaveLength(0);
  });
});

describe('agent integration — vulnerable fixture', () => {
  it('emits the seeded findings (cc-11-5 users, cc-11-6 orders, cc-11-9 documents) and no false positives on timezones/feature_flags', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const schemaPath = path.join(fixtureRoot, 'supabase/schema.sql');
    const bucketsPath = path.join(
      fixtureRoot,
      'mcp-fixtures/supabase-storage-buckets.json',
    );
    const c = await ctx();
    const agent = createSupabaseRlsAgent();
    const r = await agent.run(
      {
        schemaSource: { source: 'sql_file', schemaSqlPath: schemaPath },
        storageBucketsArtifactPath: bucketsPath,
      },
      c,
    );
    expect(r.status).toBe('completed');
    const ids = r.findings.map((f) => f.control_id);
    expect(ids).toContain('cc-11-5');
    expect(ids).toContain('cc-11-6');
    expect(ids).toContain('cc-11-9');
    expect(ids).toContain('cc-11-12');
    // No findings should reference the clean fixtures (timezones, feature_flags).
    for (const f of r.findings) {
      expect(f.title.toLowerCase()).not.toContain('timezones');
      expect(f.title.toLowerCase()).not.toContain('feature_flags');
    }
    // Strength assertions:
    const orders11_6 = r.findings.find(
      (f) => f.control_id === 'cc-11-6' && f.title.includes('orders'),
    );
    expect(orders11_6?.evidence_strength).toBe('high');
    const users11_5 = r.findings.find(
      (f) => f.control_id === 'cc-11-5' && f.title.includes('users'),
    );
    expect(users11_5?.evidence_strength).toBe('high');
  });

  it('without storage-buckets artifact, emits coverage_gap for cc-11-12', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixtureRoot = path.resolve(
      here,
      '../../../examples/vulnerable-lovable-supabase',
    );
    const schemaPath = path.join(fixtureRoot, 'supabase/schema.sql');
    const c = await ctx();
    const agent = createSupabaseRlsAgent();
    const r = await agent.run(
      { schemaSource: { source: 'sql_file', schemaSqlPath: schemaPath } },
      c,
    );
    const cc12 = r.findings.find((f) => f.control_id === 'cc-11-12');
    expect(cc12?.finding_type).toBe('coverage_gap');
  });

  it('step 26 Piece 2: loud failure — non-trivial dump that parses to 0 emits 4 coverage_gap Findings (cc-11-5/6/9/12) citing a diagnostic fact_id', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const failureShapeFixture = path.resolve(
      here,
      '__fixtures__/parse-failure-shape.sql',
    );
    const c = await ctx();
    const agent = createSupabaseRlsAgent();
    const r = await agent.run(
      { schemaSource: { source: 'sql_file', schemaSqlPath: failureShapeFixture } },
      c,
    );
    expect(r.status).toBe('completed');
    const parseFailureFindings = r.findings.filter(
      (f) => f.id.endsWith('-schema-parser-failure'),
    );
    expect(parseFailureFindings).toHaveLength(4);
    const controlIds = parseFailureFindings.map((f) => f.control_id).sort();
    expect(controlIds).toEqual(['cc-11-12', 'cc-11-5', 'cc-11-6', 'cc-11-9']);
    // Per codex retro-f1: each Finding cites the same diagnostic
    // fact_id in evidence_refs.
    const firstFactId = parseFailureFindings[0]?.evidence_refs[0];
    expect(firstFactId).toBeDefined();
    expect(firstFactId?.length).toBe(64); // sha256 hex
    for (const f of parseFailureFindings) {
      expect(f.evidence_refs).toEqual([firstFactId]);
      expect(f.finding_type).toBe('coverage_gap');
      // Allowed-claims wording — no "secure"/"safe"/"compliant" and
      // includes the diagnostic counts.
      expect(f.summary).toMatch(/Needs human review/);
      expect(f.summary).toMatch(/CREATE TABLE lines=/);
      expect(f.summary).toMatch(/CREATE POLICY lines=/);
    }
    // The warning string carries the per-line counts for audit.
    expect(r.warnings.some((w) => w.startsWith('parse_failure:'))).toBe(true);

    // Step 26 retro-f1: evidence_refs must resolve to a persisted
    // ScanFact. The agent writes supabase-parse-failure.json and the
    // Finding's evidence_refs[0] is the same fact_id that lives in
    // that artifact's scan_facts array.
    const parseFailureArtifact = r.artifacts.find((a) =>
      a.path.endsWith('supabase-parse-failure.json'),
    );
    expect(parseFailureArtifact).toBeDefined();
    if (parseFailureArtifact !== undefined) {
      const text = await fs.readFile(parseFailureArtifact.path, 'utf8');
      const parsed = JSON.parse(text) as {
        scan_facts: { fact_id: string }[];
      };
      const persistedFactIds = new Set(parsed.scan_facts.map((f) => f.fact_id));
      expect(persistedFactIds.has(firstFactId!)).toBe(true);
    }
  });

  it('step 26 Piece 2: trivial / preamble-only input does NOT trigger parse_failure (codex retro-f2 gate)', async () => {
    // Write a tiny preamble-only file to disk and run the agent
    // against it. Bytes are large (filled with SET/COMMENT lines) but
    // signal counts (CREATE TABLE / CREATE POLICY / ENABLE RLS) are
    // zero — the loud-failure gate must NOT fire.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-step26-noise-'));
    const noisePath = path.join(tmp, 'noise.sql');
    const filler = Array.from({ length: 50 })
      .map((_v, i) => `SET local.dummy_${String(i)} = 'value-${String(i)}';`)
      .join('\n');
    await fs.writeFile(noisePath, filler);
    const c = await ctx();
    const agent = createSupabaseRlsAgent();
    const r = await agent.run(
      { schemaSource: { source: 'sql_file', schemaSqlPath: noisePath } },
      c,
    );
    // No parse_failure Findings — bytes are non-trivial but signal
    // counts are zero, so the gate intentionally does not fire.
    const pf = r.findings.filter((f) => f.id.endsWith('-schema-parser-failure'));
    expect(pf).toHaveLength(0);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe('loadBucketsArtifact', () => {
  it('returns undefined when the artifact is missing', async () => {
    const out = await loadBucketsArtifact('/nope/none.json');
    expect(out).toBeUndefined();
  });
});
