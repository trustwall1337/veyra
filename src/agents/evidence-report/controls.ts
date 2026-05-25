/**
 * Canonical control catalog.
 *
 * Per FINAL_PRODUCT_PLAN §11: each entry is a `cc-11-N` control with
 * one expected behavior. The fixture's `expected-findings.json`
 * references these `control_id`s — renaming any of them requires
 * updating both files in the same commit.
 */

import type { EvidenceKind } from '../../types/evidence.js';

export interface ControlDefinition {
  readonly control_id: string;
  readonly expected_behavior: string;
  readonly required_evidence_kinds: readonly EvidenceKind[];
  readonly owning_agent_ids: readonly string[];
}

export const CONTROLS: readonly ControlDefinition[] = [
  {
    control_id: 'cc-11-1',
    expected_behavior:
      'Sensitive routes are protected by a server-side check, not only a client-side redirect.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authn'],
  },
  {
    control_id: 'cc-11-2',
    expected_behavior:
      'Admin routes are gated by a server-side role check.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authn'],
  },
  {
    control_id: 'cc-11-3',
    expected_behavior:
      'Direct-object access by id includes a per-row owner/tenant clause.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authz-tenant'],
  },
  {
    control_id: 'cc-11-4',
    expected_behavior:
      'Tenant scope on queries is derived from the authenticated session, not from client-provided parameters.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authz-tenant'],
  },
  {
    control_id: 'cc-11-5',
    expected_behavior:
      'Sensitive tables have ENABLE ROW LEVEL SECURITY set.',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['supabase-rls'],
  },
  {
    control_id: 'cc-11-6',
    expected_behavior:
      'Policies on sensitive tables do not use USING (true).',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['supabase-rls'],
  },
  {
    control_id: 'cc-11-7',
    expected_behavior:
      'Privileged keys are never present in client-shipped code.',
    required_evidence_kinds: ['scanner', 'static_code'],
    owning_agent_ids: ['tool-runner'],
  },
  {
    control_id: 'cc-11-8',
    expected_behavior:
      'No hardcoded API keys / service-role keys / cloud credentials in source.',
    required_evidence_kinds: ['scanner'],
    owning_agent_ids: ['tool-runner'],
  },
  {
    control_id: 'cc-11-9',
    expected_behavior:
      'Policies granting access to "authenticated" enforce a per-row check.',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['supabase-rls', 'authz-tenant'],
  },
  {
    control_id: 'cc-11-10',
    expected_behavior:
      'Dependencies have no known critical / high CVEs unmitigated.',
    required_evidence_kinds: ['scanner'],
    owning_agent_ids: ['tool-runner'],
  },
  {
    control_id: 'cc-11-11',
    expected_behavior:
      'Business-logic invariants (price, refund, total) cannot be bypassed by client manipulation.',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['business-logic'],
  },
  {
    control_id: 'cc-11-12',
    expected_behavior:
      'Public storage buckets do not grant SELECT to anon for private data.',
    required_evidence_kinds: ['mcp_context'],
    owning_agent_ids: ['supabase-rls'],
  },
];

export function findControl(id: string): ControlDefinition | undefined {
  return CONTROLS.find((c) => c.control_id === id);
}
