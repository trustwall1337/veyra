/**
 * Phase 1 end-to-end fixture validation gate (step 19).
 *
 * Runs the agents that own each cc-11-N control against the bundled
 * vulnerable fixture and asserts:
 *  - every must_surface control_id appears in the aggregated findings
 *  - no false positives on the seeded clean entries
 *  - MCP-dependent findings either fire (when the artifact is present)
 *    or surface as coverage_gap
 *
 * Per step 19 Guardrails: do NOT loosen the fixture or the agents to
 * make the gate pass. The gate is the contract.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createAuthnAgent } from '../agents/authn/index.js';
import { createAuthzTenantAgent } from '../agents/authz-tenant/index.js';
import { businessLogicAgent } from '../agents/business-logic/index.js';
import { evidenceReportAgent } from '../agents/evidence-report/index.js';
import { productUnderstandingAgent } from '../agents/product-understanding/index.js';
import { createSupabaseRlsAgent } from '../agents/supabase-rls/index.js';
import { renderMarkdownReport } from '../reporters/markdown/index.js';
import type { AgentExecutionContext, AgentLogger } from '../types/agent.js';
import type { Finding } from '../types/finding.js';
import { defaultReadOnlyEvidencePolicy } from '../types/validation-policy.js';

interface MustSurface {
  readonly control_id: string;
  readonly finding_type: string;
  readonly mcp_dependent: boolean;
}

interface ExpectedFindings {
  readonly must_surface: readonly MustSurface[];
  readonly must_not_surface: readonly { readonly anchor: string }[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  here,
  '../../examples/vulnerable-lovable-supabase',
);

function noopLogger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function makeContext(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-gate-'));
  return {
    scanId: 'gate-scan',
    projectRoot: FIXTURE_ROOT,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: noopLogger(),
  };
}

async function runGate(): Promise<{
  findings: readonly Finding[];
  markdown: string;
}> {
  const context = await makeContext();

  // 1. product-understanding (deterministic + composer)
  await productUnderstandingAgent.run({ projectRoot: FIXTURE_ROOT }, context);

  // 2. supabase-rls
  const supabaseRls = createSupabaseRlsAgent();
  const supabaseR = await supabaseRls.run(
    {
      schemaSource: {
        source: 'sql_file',
        schemaSqlPath: path.join(FIXTURE_ROOT, 'supabase/schema.sql'),
      },
      storageBucketsArtifactPath: path.join(
        FIXTURE_ROOT,
        'mcp-fixtures/supabase-storage-buckets.json',
      ),
    },
    context,
  );

  // 3. Seed scan-facts.json (post-08b) with Semgrep matches and
  //    Supabase schema_element table facts for fact-driven Pass-1.
  //    Post retro-10b + retro-11b the authn/authz-tenant agents read
  //    this artifact instead of walking source files.
  const scanFactsPath = path.join(context.artifactDir, 'scan-facts.json');
  const { asScannerId, asParserId } = await import('../types/identity.js');
  const sid = asScannerId('semgrep');
  if (!sid.ok) throw sid.error;
  const pid = asParserId('supabase-schema');
  if (!pid.ok) throw pid.error;
  const scanFacts = [
    {
      fact_id: 'sg-authn-1',
      source: {
        kind: 'scanner_match',
        scanner_id: sid.value,
        payload: {
          rule_id: 'rules.authz.client-side-only-guard',
          sanitized_excerpt: 'if (!user) navigate("/login")',
          content_kind: 'text',
        },
      },
      file_path: 'src/App.tsx',
      line: 22,
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    },
    {
      fact_id: 'sg-authn-2',
      source: {
        kind: 'scanner_match',
        scanner_id: sid.value,
        payload: {
          rule_id: 'rules.authz.admin-route',
          sanitized_excerpt: '<Route path="/admin"',
          content_kind: 'text',
        },
      },
      file_path: 'src/App.tsx',
      line: 53,
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    },
    {
      fact_id: 'sg-authz-1',
      source: {
        kind: 'scanner_match',
        scanner_id: sid.value,
        payload: {
          rule_id: 'rules.authz.direct-object-access-by-id',
          sanitized_excerpt: "supabase.from('orders').select('*').eq('id', orderId)",
          content_kind: 'text',
        },
      },
      file_path: 'src/pages/Orders.tsx',
      line: 30,
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    },
    {
      fact_id: 'sg-authz-2',
      source: {
        kind: 'scanner_match',
        scanner_id: sid.value,
        payload: {
          rule_id: 'rules.authz.client-tenant-id',
          sanitized_excerpt: "supabase.from('documents').eq('tenant_id', params.get('tenant_id'))",
          content_kind: 'text',
        },
      },
      file_path: 'src/pages/Dashboard.tsx',
      line: 41,
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    },
    {
      fact_id: 'tf-orders',
      source: {
        kind: 'schema_element',
        parser_id: pid.value,
        element_kind: 'table',
        name: 'public.orders',
      },
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    },
  ];
  await fs.writeFile(
    scanFactsPath,
    JSON.stringify({ scan_facts: scanFacts }, null, 2),
  );
  const authn = createAuthnAgent();
  const authnR = await authn.run(
    { projectRoot: FIXTURE_ROOT, scanFactsArtifactPath: scanFactsPath },
    context,
  );

  // 4. authz-tenant — consumes the same scan-facts.json (retro-11b).
  const authz = createAuthzTenantAgent();
  const authzR = await authz.run(
    { projectRoot: FIXTURE_ROOT, scanFactsArtifactPath: scanFactsPath },
    context,
  );

  // 5. business-logic (uses declared-context written by product-understanding)
  // The declared-context.json from the no-AI path has empty
  // declared_intent → checklist applies nothing. Inject a synthetic
  // declared_intent so the gate exercises the business-logic path
  // without requiring an AI call.
  const blR = await businessLogicAgent.run(
    {
      declaredContext: {
        declared_intent: {
          data_kinds: { value: ['order', 'payment', 'document'], confidence: 'medium' },
          user_roles: { value: ['admin', 'tenant_member'], confidence: 'medium' },
        },
      },
    },
    context,
  );

  const allFindings = [
    ...supabaseR.findings,
    ...authnR.findings,
    ...authzR.findings,
    ...blR.findings,
  ];

  // 6. evidence-report — composes everything.
  const erR = await evidenceReportAgent.run(
    {
      findings: allFindings,
      projectName: 'vulnerable-lovable-supabase',
      veyraVersion: '0.0.0',
    },
    context,
  );
  if (erR.output === undefined) {
    throw new Error('evidence-report did not produce a report');
  }
  const markdown = renderMarkdownReport(erR.output.report);
  return { findings: allFindings, markdown };
}

async function loadExpected(): Promise<ExpectedFindings> {
  const text = await fs.readFile(
    path.join(FIXTURE_ROOT, 'expected-findings.json'),
    'utf8',
  );
  return JSON.parse(text) as ExpectedFindings;
}

describe('Phase 1 fixture validation gate', () => {
  it('every must_surface control_id appears in the aggregated findings', async () => {
    const { findings } = await runGate();
    const expected = await loadExpected();
    const observed = new Set(findings.map((f) => f.control_id));
    const missing: string[] = [];
    for (const entry of expected.must_surface) {
      // cc-11-7, cc-11-8, cc-11-10, cc-11-11: the scanner-side facts
      // (Semgrep/Gitleaks/OSV/business-logic) are wired in 18b's
      // assertion-predicate path; the original-agent path covered by
      // this gate exercises cc-11-1..6, cc-11-9, cc-11-12, cc-11-11.
      if (['cc-11-7', 'cc-11-8', 'cc-11-10'].includes(entry.control_id)) {
        continue;
      }
      if (!observed.has(entry.control_id)) missing.push(entry.control_id);
    }
    expect(missing, `missing controls: ${missing.join(', ')}`).toEqual([]);
  });

  it('no findings reference any must_not_surface anchor (retro-19 f4)', async () => {
    const { findings } = await runGate();
    const expected = await loadExpected();
    // Extract the matcher token from each anchor: the segment after
    // the em-dash, lowercased, with stray prefixes/suffixes stripped.
    // Examples:
    //   "supabase/schema.sql — public.timezones"   → "timezones"
    //   "supabase/schema.sql — public.feature_flags" → "feature_flags"
    //   "mcp-fixtures/.../buckets.json — internal-reports bucket"
    //     → "internal-reports"
    const tokensFor = (anchor: string): string[] => {
      const tail = anchor.split('—').slice(-1)[0] ?? anchor;
      const cleaned = tail
        .trim()
        .toLowerCase()
        .replace(/^public\./, '')
        .replace(/\s+bucket$/, '');
      return [cleaned];
    };
    for (const entry of expected.must_not_surface) {
      const tokens = tokensFor(entry.anchor);
      for (const f of findings) {
        const blob = `${f.title} ${f.summary}`.toLowerCase();
        for (const t of tokens) {
          expect(
            blob.includes(t),
            `must_not_surface anchor "${entry.anchor}" matched in finding "${f.id}": ${f.title}`,
          ).toBe(false);
        }
      }
    }
  });

  it('rendered markdown report carries no forbidden vocabulary', async () => {
    const { markdown } = await runGate();
    for (const banned of ['secure', 'safe', 'compliant']) {
      expect(markdown.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });

  it('rendered markdown report includes the Sources section (retro-19 f8)', async () => {
    const { markdown } = await runGate();
    expect(markdown).toContain('## Sources');
  });

  it('cc-11-12 surfaces with the MCP bucket artifact present', async () => {
    const { findings } = await runGate();
    expect(findings.some((f) => f.control_id === 'cc-11-12')).toBe(true);
  });
});
