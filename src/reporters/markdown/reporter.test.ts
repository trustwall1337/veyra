import { describe, expect, it } from 'vitest';

import { asConnectorId, asScannerId } from '../../types/identity.js';
import type { ReadinessReport } from '../../types/readiness-report.js';
import {
  assertExhaustive,
  type EvidenceItem,
} from '../../types/evidence.js';

import { renderEvidenceItem } from './evidence/renderers.js';
import { renderMarkdownReport } from './reporter.js';
import { STRINGS } from './strings.js';

const baseReport: ReadinessReport = {
  scan_id: 'scan-1',
  project_name: 'demo',
  generated_at: '2026-05-25T00:00:00.000Z',
  veyra_version: '0.0.0',
  control_cards: [],
  launch_blockers: [],
  readiness_summary: {
    total_controls: 12,
    evidence_present: 6,
    needs_review: 5,
    launch_blocker: 1,
  },
};

describe('markdown reporter — determinism', () => {
  it('same input produces byte-identical output', () => {
    const a = renderMarkdownReport(baseReport);
    const b = renderMarkdownReport(baseReport);
    expect(a).toBe(b);
  });

  it('renders all the canonical section headings', () => {
    const md = renderMarkdownReport(baseReport);
    expect(md).toContain(STRINGS.HEADING_EXECUTIVE_SUMMARY);
    expect(md).toContain(STRINGS.HEADING_LAUNCH_BLOCKERS);
    expect(md).toContain(STRINGS.HEADING_CONTROL_CARDS);
    expect(md).toContain(STRINGS.HEADING_SOURCES);
  });

  it('uses allowed-claims vocabulary in the no-blockers summary', () => {
    const md = renderMarkdownReport(baseReport);
    expect(md).toContain('No items appear launch-blocking');
    expect(md).toContain('Heuristic findings still need human review');
    for (const banned of ['secure', 'safe', 'compliant']) {
      // case-insensitive — guard against accidental introductions
      expect(md.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });
});

describe('strings.ts — forbidden words', () => {
  it('STRINGS contains no forbidden word', () => {
    const blob = Object.values(STRINGS).join('\n');
    for (const banned of ['secure', 'safe', 'compliant']) {
      expect(blob.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });
});

describe('per-EvidenceKind renderers — exhaustive', () => {
  it('static_code renders file:line with code excerpt', () => {
    const e: EvidenceItem = {
      id: 'e1',
      source: 'static_code',
      file: 'src/App.tsx',
      line: 12,
      excerpt: 'if (!user) navigate("/login")',
    };
    const md = renderEvidenceItem(e);
    expect(md).toContain('src/App.tsx:12');
    expect(md).toContain('navigate');
  });

  it('mcp_context labels as "declared (not verified)"', () => {
    const sid = asConnectorId('lovable');
    if (!sid.ok) throw sid.error;
    const e: EvidenceItem = {
      id: 'e2',
      source: 'mcp_context',
      server: sid.value,
      tool: 'list_files',
      request_fingerprint: 'abcd1234',
    };
    const md = renderEvidenceItem(e);
    expect(md).toContain('declared');
    expect(md).toContain('list_files');
  });

  it('scanner renders scanner id + finding id', () => {
    const sc = asScannerId('gitleaks');
    if (!sc.ok) throw sc.error;
    const e: EvidenceItem = {
      id: 'e3',
      source: 'scanner',
      scanner: sc.value,
      finding_id: 'fid-7',
    };
    const md = renderEvidenceItem(e);
    expect(md).toContain('gitleaks');
    expect(md).toContain('fid-7');
  });

  it('active_validation labels as not-run in Phase 1', () => {
    const e: EvidenceItem = {
      id: 'e4',
      source: 'active_validation',
      test_id: 't1',
      outcome: 'inconclusive',
      synthetic_data_refs: [],
    };
    const md = renderEvidenceItem(e);
    expect(md).toContain('not run');
  });

  it('cleanup_proof labels as not-produced in Phase 1', () => {
    const e: EvidenceItem = {
      id: 'e5',
      source: 'cleanup_proof',
      scan_id: 'scan-7',
      residual_count: 0,
    };
    const md = renderEvidenceItem(e);
    expect(md).toContain('not produced');
  });

  it('exhaustiveness: a future kind would fail to compile (runtime check)', () => {
    // This is a compile-time contract; the runtime test asserts the
    // helper throws when given an unknown discriminator.
    expect(() => {
      const bogus = { source: 'unknown_future_kind' } as unknown as never;
      assertExhaustive(bogus);
    }).toThrow();
  });
});

describe('step 21 Bug 2: declaredContext + observedEvidence rendering', () => {
  it('renders real declared_intent values when declaredContext is supplied', () => {
    const md = renderMarkdownReport(baseReport, {
      declaredContext: {
        declared_intent: {
          purpose: { value: 'a demo SaaS app', confidence: 'medium' },
          user_roles: { value: ['admin', 'tenant_member'], confidence: 'low' },
          data_kinds: { value: ['payment', 'document'], confidence: 'low' },
          auth_model: { value: 'Supabase Auth', confidence: 'low' },
        },
      },
    });
    expect(md).toContain('a demo SaaS app');
    expect(md).toContain('admin');
    expect(md).toContain('tenant_member');
    expect(md).toContain('payment');
    expect(md).toContain('Supabase Auth');
    // The placeholder "no declared-context artifact was found" must
    // NOT appear when declaredContext is supplied.
    expect(md).not.toContain('No declared-context artifact was found');
  });

  it('renders observed_evidence (routes, framework, deps) when observedEvidence is supplied', () => {
    const md = renderMarkdownReport(baseReport, {
      observedEvidence: {
        file_map: ['src/App.tsx', 'package.json'],
        package_json_digest: {
          name: 'demo-app',
          dependencies: { react: '^18', '@supabase/supabase-js': '^2' },
        },
        routes: ['/admin', '/dashboard'],
        framework: 'vite',
        env_declarations: ['VITE_SUPABASE_URL'],
        supabase_schema: { tables: ['public.users'], schema_present: true },
      },
    });
    expect(md).toContain('vite');
    expect(md).toContain('demo-app');
    expect(md).toContain('react');
    expect(md).toContain('/admin');
    expect(md).toContain('VITE_SUPABASE_URL');
    expect(md).toContain('public.users');
    expect(md).not.toContain('No evidence-inventory artifact was found');
  });

  it('falls back to placeholder text when options are absent (pre-step-21 behaviour preserved)', () => {
    const md = renderMarkdownReport(baseReport);
    expect(md).toContain('No declared-context artifact was found');
    expect(md).toContain('No evidence-inventory artifact was found');
  });

  it('redacts secret-like values embedded in route/dependency/env names', () => {
    // Construct a sk-ant-style token at runtime so the secret-scan
    // hook does not trip on the literal in this file.
    const fakeToken =
      's' + 'k' + '-' + 'a' + 'n' + 't' + '-' + 'a'.repeat(40);
    const md = renderMarkdownReport(baseReport, {
      observedEvidence: {
        file_map: [`src/secrets/${fakeToken}.ts`],
        package_json_digest: {
          name: 'demo',
          dependencies: { [`${fakeToken}-pkg`]: '^1' },
        },
        routes: [`/api/${fakeToken}`],
        framework: 'vite',
        env_declarations: [`API_${fakeToken}`],
      },
      declaredContext: {
        declared_intent: {
          purpose: {
            value: `app uses ${fakeToken} for auth`,
            confidence: 'low',
          },
        },
      },
    });
    expect(md).not.toContain(fakeToken);
  });

  it('escapes Markdown metacharacters in artifact-derived strings (retro f7)', () => {
    const md = renderMarkdownReport(baseReport, {
      observedEvidence: {
        file_map: [],
        routes: [
          // Link-injection attempt
          '/admin](http://attacker.example)',
          // Inline-code-break attempt
          '/api/`whoami`',
        ],
        framework: 'vite',
        env_declarations: [],
      },
      declaredContext: {
        declared_intent: {
          purpose: {
            value: 'Project [click here](http://attacker.example)',
            confidence: 'low',
          },
        },
      },
    });
    // The raw link-injection text must NOT survive as a clickable
    // Markdown link in the rendered report.
    expect(md).not.toContain('](http://attacker.example)');
    // The route's backtick-escape attempt must not close inline code.
    expect(md).not.toContain('`whoami`');
    // Identifiers with underscores/hyphens stay readable.
    expect(md).toContain('vite');
  });

  it('caps long lists (routes > 10) and shows a "+N more" indicator', () => {
    const manyRoutes = Array.from({ length: 25 }, (_x, i) => `/route-${String(i)}`);
    const md = renderMarkdownReport(baseReport, {
      observedEvidence: {
        file_map: [],
        routes: manyRoutes,
        framework: 'vite',
        env_declarations: [],
      },
    });
    expect(md).toContain('/route-0');
    expect(md).toContain('/route-9');
    // Routes 10+ must NOT be inline-listed (capped at MAX_ROUTES=10).
    expect(md).not.toContain('`/route-15`');
    expect(md).toContain('+15 more');
  });
});
