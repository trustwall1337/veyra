import { describe, expect, it } from 'vitest';

import { asParserId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';

import {
  predicateCrossTenantInvite,
  predicateRefundFlow,
  predicateSelfApproval,
  predicatesBusinessLogic,
} from './predicates.js';

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
          rls_enabled: true,
        }),
        content_kind: 'json',
      },
    },
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: false,
  };
}

describe('predicatesBusinessLogic — fact-driven', () => {
  it('fires self-approval + refund predicates when schema-element facts include payment-shaped tables', () => {
    const findings = predicatesBusinessLogic(
      [tableFact('payments'), tableFact('orders')],
      {
        declared_intent: {
          data_kinds: { value: ['payments'], confidence: 'medium' },
        },
      },
    );
    const ids = findings.map((f) => f.id);
    expect(ids).toContain('business-self-approval-coverage-gap');
    expect(ids).toContain('business-refund-flow-authz-coverage-gap');
  });

  it('NEVER emits confirmed_issue (constraint 10 enforcement)', () => {
    const findings = predicatesBusinessLogic([tableFact('payments')], {
      declared_intent: {
        data_kinds: { value: ['payment', 'order', 'file'], confidence: 'medium' },
        user_roles: { value: ['admin', 'tenant_member'], confidence: 'medium' },
      },
    });
    for (const f of findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
  });

  it('emits nothing when neither facts nor declared context match the checklist', () => {
    const findings = predicatesBusinessLogic(
      [tableFact('timezones')],
      {
        declared_intent: {
          data_kinds: { value: ['unrelated'], confidence: 'low' },
        },
      },
    );
    expect(findings).toEqual([]);
  });
});

describe('individual predicates — pure on ScanFact[] + declared context', () => {
  it('predicateSelfApproval fires on payment-shaped data', () => {
    const f = predicateSelfApproval([], {
      declared_intent: {
        data_kinds: { value: ['payment'], confidence: 'medium' },
      },
    });
    expect(f.length).toBe(1);
  });

  it('predicateCrossTenantInvite fires when declared context mentions tenant roles', () => {
    const f = predicateCrossTenantInvite([], {
      declared_intent: {
        user_roles: { value: ['tenant_member'], confidence: 'medium' },
      },
    });
    expect(f.length).toBe(1);
  });

  it('predicateRefundFlow fires on stripe dep or payment data_kind', () => {
    const f = predicateRefundFlow([], {
      observed_evidence: {
        package_json_digest: {
          name: 'demo',
          dependencies: { stripe: '^14' },
        },
      },
    });
    expect(f.length).toBe(1);
  });
});

describe('retro-12b f2: evidence_refs carry triggering fact_ids', () => {
  it('coverage_gap findings cite the schema_element fact_ids they fired on', () => {
    const facts = [tableFact('payments'), tableFact('orders')];
    const findings = predicatesBusinessLogic(facts, {
      declared_intent: {
        data_kinds: { value: ['payments'], confidence: 'medium' },
      },
    });
    const refs = new Set(findings.flatMap((f) => f.evidence_refs));
    expect(refs.has('tf-payments')).toBe(true);
    expect(refs.has('tf-orders')).toBe(true);
  });
});

describe('retro-12b f5: source.name is the structured API (not sanitized_excerpt)', () => {
  it('detects tables from source.name even when payload is absent', () => {
    const pid = asParserId('supabase-schema');
    if (!pid.ok) throw pid.error;
    const factSansExcerpt: ScanFact = {
      fact_id: 'tf-no-excerpt',
      source: {
        kind: 'schema_element',
        parser_id: pid.value,
        element_kind: 'table',
        name: 'public.payments',
      },
      observed_at: '2026-05-25T00:00:00Z',
      args_fingerprint_sha256: 'x',
      redacted: false,
    };
    const findings = predicatesBusinessLogic([factSansExcerpt], {
      declared_intent: {
        data_kinds: { value: ['payments'], confidence: 'medium' },
      },
    });
    const ids = findings.map((f) => f.id);
    expect(ids).toContain('business-self-approval-coverage-gap');
    expect(ids).toContain('business-refund-flow-authz-coverage-gap');
  });
});

describe('predicate purity (constraint 10)', () => {
  it('signature accepts only ScanFact[] + optional declared context (no Hypothesis)', () => {
    const _t: (
      facts: readonly ScanFact[],
      declared?: unknown,
    ) => readonly unknown[] = predicatesBusinessLogic;
    void _t;
    expect(true).toBe(true);
  });
});
