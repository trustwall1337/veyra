import { describe, expect, it } from 'vitest';

import type { ScanFact } from '../../types/scan-fact.js';

import {
  predicateAllAuthenticated,
  predicateBroadPolicy,
  predicatePublicBucket,
  predicateRlsMissing,
} from './predicates.js';
import {
  SUPABASE_SCHEMA_PARSER_ID,
  buildSchemaFacts,
} from './schema-facts.js';

function tableFact(name: string, rls: boolean): ScanFact {
  return {
    fact_id: `t-${name}`,
    source: {
      kind: 'schema_element',
      parser_id: SUPABASE_SCHEMA_PARSER_ID,
      element_kind: 'table',
      name: `public.${name}`,
      payload: {
        sanitized_excerpt: JSON.stringify({
          schema: 'public',
          name,
          rls_enabled: rls,
          source_range: { start: 1, end: 2 },
        }),
        content_kind: 'json',
      },
    },
    file_path: 'schema.sql',
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

describe('predicates — facts-only (constraint 10)', () => {
  it('cc-11-5 fires on sensitive RLS-off table; ignores non-sensitive', () => {
    const facts = [tableFact('users', false), tableFact('timezones', false)];
    const f = predicateRlsMissing(facts);
    expect(f.length).toBe(1);
    expect(f[0]?.control_id).toBe('cc-11-5');
  });

  it('predicates accept only ScanFact[]; type-level absence of Hypothesis input', () => {
    // This is a compile-time contract — exercised by the signature
    // below. Each predicate's parameter type is `readonly ScanFact[]`.
    // Adding `Hypothesis[]` would fail to compile; this runtime test
    // documents the boundary.
    const _t: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateRlsMissing;
    void _t;
    const _u: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateBroadPolicy;
    void _u;
    expect(true).toBe(true);
  });

  it('cc-11-12 emits coverage_gap when no bucket facts are present', () => {
    const f = predicatePublicBucket([]);
    expect(f[0]?.finding_type).toBe('coverage_gap');
  });
});

describe('buildSchemaFacts — fact ids stable across runs', () => {
  it('produces deterministic fact_ids for identical input', () => {
    const parsed = {
      tables: [
        {
          schema: 'public',
          name: 'orders',
          source_range: { start: 1, end: 2 },
          rls_enabled: false,
        },
      ],
      policies: [],
      grants: [],
      unparseable: [],
    } as const;
    const a = buildSchemaFacts(parsed, '/x/schema.sql');
    const b = buildSchemaFacts(parsed, '/x/schema.sql');
    expect(a[0]?.fact_id).toBe(b[0]?.fact_id);
  });
});

describe('cc-11-9 predicate ignores tables without TO authenticated', () => {
  it('does not fire on a policy without a role', () => {
    const policyFact: ScanFact = {
      fact_id: 'p-1',
      source: {
        kind: 'schema_element',
        parser_id: SUPABASE_SCHEMA_PARSER_ID,
        element_kind: 'policy',
        name: 'public.orders:orders_select_anyone',
        payload: {
          sanitized_excerpt: JSON.stringify({
            name: 'orders_select_anyone',
            schema: 'public',
            table: 'orders',
            operation: 'SELECT',
            using_expr: 'true',
          }),
          content_kind: 'json',
        },
      },
      file_path: 'schema.sql',
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    };
    const findings = predicateAllAuthenticated([policyFact]);
    expect(findings.length).toBe(0);
  });
});
