import { describe, expect, it } from 'vitest';

import { asParserId, asScannerId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';

import {
  authzCoverageGaps,
  predicateClientTenantId,
  predicateCrossTenantWriteRisk,
  predicateDirectObjectAccess,
} from './predicates.js';

function semgrepFact(
  ruleId: string,
  excerpt: string,
  filePath = 'src/x.ts',
): ScanFact {
  const sid = asScannerId('semgrep');
  if (!sid.ok) throw sid.error;
  return {
    fact_id: `sf-${ruleId}-${filePath}-${excerpt.length}`,
    source: {
      kind: 'scanner_match',
      scanner_id: sid.value,
      payload: {
        sanitized_excerpt: excerpt,
        content_kind: 'text',
        rule_id: ruleId,
      },
    },
    file_path: filePath,
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

function tableFact(name: string): ScanFact {
  const pid = asParserId('supabase-schema');
  if (!pid.ok) throw pid.error;
  return {
    fact_id: `tf-${name}`,
    source: {
      kind: 'schema_element',
      parser_id: pid.value,
      element_kind: 'table',
      name: `public.${name}`,
      payload: {
        sanitized_excerpt: JSON.stringify({
          schema: 'public',
          name,
          rls_enabled: false,
        }),
        content_kind: 'json',
      },
    },
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

function policyFact(name: string, table: string, role: string, usingExpr: string): ScanFact {
  const pid = asParserId('supabase-schema');
  if (!pid.ok) throw pid.error;
  return {
    fact_id: `pf-${name}`,
    source: {
      kind: 'schema_element',
      parser_id: pid.value,
      element_kind: 'policy',
      name: `public.${table}:${name}`,
      payload: {
        sanitized_excerpt: JSON.stringify({
          name,
          schema: 'public',
          table,
          operation: 'SELECT',
          role,
          using_expr: usingExpr,
        }),
        content_kind: 'json',
      },
    },
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

describe('cc-11-3 direct-object-access predicate', () => {
  it('fires on a Semgrep direct-object-access fact', () => {
    const findings = predicateDirectObjectAccess([
      semgrepFact(
        'authz.direct-object-access-by-id',
        ".from('orders').eq('id', orderId)",
      ),
      tableFact('orders'),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.control_id).toBe('cc-11-3');
  });

  it('emits nothing without a matching rule_id', () => {
    const findings = predicateDirectObjectAccess([
      semgrepFact('rules.misc.unrelated', 'some'),
    ]);
    expect(findings).toEqual([]);
  });
});

describe('cc-11-4 client-tenant predicate', () => {
  it('fires on the client-tenant rule_id', () => {
    const findings = predicateClientTenantId([
      semgrepFact('authz.client-tenant-id', "params.get('tenant_id')"),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.control_id).toBe('cc-11-4');
  });
});

describe('cc-11-9 cross-tenant-write-risk predicate', () => {
  it('fires only when BOTH a write fact and a broad policy fact are present', () => {
    const a = predicateCrossTenantWriteRisk([
      semgrepFact('authz.write-without-tenant-check', 'documents'),
      policyFact('open', 'documents', 'authenticated', 'true'),
    ]);
    expect(a.length).toBe(1);
    const b = predicateCrossTenantWriteRisk([
      semgrepFact('authz.write-without-tenant-check', 'documents'),
    ]);
    expect(b.length).toBe(0);
  });
});

describe('authzCoverageGaps', () => {
  it('emits a coverage gap when no schema-element table facts are present', () => {
    const findings = authzCoverageGaps([]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.finding_type).toBe('coverage_gap');
  });

  it('emits nothing when at least one table fact is present', () => {
    const findings = authzCoverageGaps([tableFact('orders')]);
    expect(findings).toEqual([]);
  });
});

describe('predicate purity', () => {
  it('signature accepts only readonly ScanFact[]', () => {
    const _a: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateDirectObjectAccess;
    const _b: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateClientTenantId;
    const _c: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateCrossTenantWriteRisk;
    void _a;
    void _b;
    void _c;
    expect(true).toBe(true);
  });
});
