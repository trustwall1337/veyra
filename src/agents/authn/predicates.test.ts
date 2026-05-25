import { describe, expect, it } from 'vitest';

import { asScannerId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';

import {
  authnCoverageGaps,
  predicateAdminWithoutServerCheck,
  predicateClientOnlyProtection,
} from './predicates.js';

function semgrepFact(ruleId: string, filePath: string, line: number): ScanFact {
  const scannerId = asScannerId('semgrep');
  if (!scannerId.ok) throw scannerId.error;
  return {
    fact_id: `sf-${ruleId}-${filePath}-${String(line)}`,
    source: {
      kind: 'scanner_match',
      scanner_id: scannerId.value,
      payload: {
        sanitized_excerpt: `${ruleId}: example`,
        content_kind: 'text',
        rule_id: ruleId,
      },
    },
    file_path: filePath,
    line,
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

describe('predicateClientOnlyProtection', () => {
  it('fires on a client-side-only-guard fact', () => {
    const findings = predicateClientOnlyProtection([
      semgrepFact('authn.client-side-only-guard', 'src/App.tsx', 22),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.control_id).toBe('cc-11-1');
  });

  it('emits nothing when no client-guard facts are present', () => {
    const findings = predicateClientOnlyProtection([
      semgrepFact('rules.misc.unrelated', 'src/x.ts', 1),
    ]);
    expect(findings).toEqual([]);
  });
});

describe('predicateAdminWithoutServerCheck', () => {
  it('fires on admin-route fact when no server-role-check fact exists', () => {
    const findings = predicateAdminWithoutServerCheck([
      semgrepFact('authn.admin-route-no-server-check', 'src/App.tsx', 53),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.control_id).toBe('cc-11-2');
  });

  it('does NOT fire when a server-role-check fact accompanies the admin route', () => {
    const findings = predicateAdminWithoutServerCheck([
      semgrepFact('authn.admin-route-no-server-check', 'src/App.tsx', 53),
      semgrepFact('authn.server-role-check', 'src/lib/auth.ts', 4),
    ]);
    expect(findings).toEqual([]);
  });
});

describe('authnCoverageGaps', () => {
  it('emits a coverage_gap finding when no relevant facts are observed', () => {
    const findings = authnCoverageGaps([]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.finding_type).toBe('coverage_gap');
    expect(findings[0]?.control_id).toBe('cc-11-1');
  });

  it('emits nothing when at least one relevant fact is observed', () => {
    const findings = authnCoverageGaps([
      semgrepFact('authn.client-side-only-guard', 'src/App.tsx', 22),
    ]);
    expect(findings).toEqual([]);
  });
});

describe('predicate purity', () => {
  it('signature accepts only ScanFact[] (compile-time contract)', () => {
    const _t: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateClientOnlyProtection;
    const _u: (facts: readonly ScanFact[]) => readonly unknown[] =
      predicateAdminWithoutServerCheck;
    void _t;
    void _u;
    expect(true).toBe(true);
  });
});
