import { describe, expect, it } from 'vitest';

import {
  type ActiveValidationResult,
  type CleanupPolicy,
  type SyntheticDataPolicy,
  type TestIdentity,
  type TestPlanEntry,
  type TestRecord,
  type TestTenant,
} from './active-validation.js';
import { asAnalyzerId, asConnectorId } from './identity.js';

function connectorId(s: string) {
  const r = asConnectorId(s);
  if (!r.ok) throw r.error;
  return r.value;
}
function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('TestIdentity shape (step 2.02 codex pf1: no provider-named field)', () => {
  it('uses provider_subject_id + identity_provider_id (opaque ConnectorId)', () => {
    const id: TestIdentity = {
      id: 'ti-1',
      scan_id: 'scan-1',
      provider_subject_id: 'subj-abc',
      identity_provider_id: connectorId('supabase-auth'),
      role: 'authenticated',
      tenant_id: 't1',
      created_at: '2026-05-26T00:00:00Z',
    };
    expect(id.provider_subject_id).toBe('subj-abc');
    expect(typeof id.identity_provider_id).toBe('string');
  });

  it('TestIdentity has NO `supabase_user_id` field (would be FPP §2A drift)', () => {
    type Keys = keyof TestIdentity;
    const _exhaustive: Record<Keys, true> = {
      id: true,
      scan_id: true,
      provider_subject_id: true,
      identity_provider_id: true,
      role: true,
      tenant_id: true,
      created_at: true,
    };
    expect(_exhaustive).toBeDefined();
    // No key matches /supabase/i.
    for (const k of Object.keys(_exhaustive)) {
      expect(/supabase/i.test(k)).toBe(false);
    }
  });
});

describe('CleanupPolicy literal-union pin', () => {
  it('strategy is the closed pair, on_cleanup_failure is locked', () => {
    const p: CleanupPolicy = {
      strategy: 'hard_delete',
      verify_residual_count: true,
      on_cleanup_failure: 'fail_scan',
    };
    expect(p.on_cleanup_failure).toBe('fail_scan');
  });
});

describe('SyntheticDataPolicy + TestTenant + TestRecord constructions', () => {
  it('SyntheticDataPolicy accepts integer caps + lifetime', () => {
    const p: SyntheticDataPolicy = {
      namespace_prefix: 'veyra-test-',
      max_identities: 5,
      max_tenants: 2,
      max_records: 20,
      max_lifetime_seconds: 600,
    };
    expect(p.namespace_prefix.startsWith('veyra-')).toBe(true);
  });

  it('TestTenant + TestRecord round-trip', () => {
    const t: TestTenant = {
      id: 'tt-1',
      scan_id: 'scan-1',
      name: 'veyra-tenant',
      owner_test_identity_id: 'ti-1',
      created_at: '2026-05-26T00:00:00Z',
    };
    const r: TestRecord = {
      id: 'tr-1',
      scan_id: 'scan-1',
      table: 'orders',
      row_data_fingerprint: 'sha256:abc',
      created_at: '2026-05-26T00:00:00Z',
    };
    expect(t.owner_test_identity_id).toBe('ti-1');
    expect(r.table).toBe('orders');
  });
});

describe('ActiveValidationResult.outcome union pin', () => {
  it('accepts only the three closed literals', () => {
    const allowed = ['proven_denial', 'proven_allowed', 'inconclusive'] as const;
    for (const outcome of allowed) {
      const r: ActiveValidationResult = {
        test_id: 't',
        control_id: 'cc-11-1',
        outcome,
        evidence_refs: [],
        duration_ms: 0,
        synthetic_data_refs: [],
        assertion_details: {},
      };
      expect(allowed).toContain(r.outcome);
    }
  });
});

describe('TestPlanEntry shape', () => {
  it('owning_agent_id is an opaque AnalyzerId; required_synthetic_resources is a closed set', () => {
    const e: TestPlanEntry = {
      test_id: 't',
      control_id: 'cc-11-1',
      owning_agent_id: analyzerId('authz-tenant'),
      required_synthetic_resources: ['identity', 'tenant'],
      expected_outcome_hint: 'proven_denial',
      max_duration_ms: 5000,
    };
    expect(e.required_synthetic_resources).toEqual(['identity', 'tenant']);
  });
});
