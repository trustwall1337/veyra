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
  /**
   * Codex retro 2.07d-controls-missing-active-metadata: true when a
   * Phase 2 active-validation catalog test exists for this control.
   * The catalog drift guard (step 2.07) derives its expected set
   * from this flag rather than a hardcoded array.
   */
  readonly phase_2_active_supported?: boolean;
  /**
   * Codex retro 2.07d: scenario variants the gate must cover for
   * full coverage of this control (e.g. cc-11-5 needs rls_on +
   * rls_off). When omitted, the control has a single canonical
   * scenario.
   */
  readonly required_scenario_set?: readonly string[];
}

export const CONTROLS: readonly ControlDefinition[] = [
  {
    control_id: 'cc-11-1',
    expected_behavior:
      'Sensitive routes are protected by a server-side check, not only a client-side redirect.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authn'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-2',
    expected_behavior:
      'Admin routes are gated by a server-side role check.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authn'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-3',
    expected_behavior:
      'Direct-object access by id includes a per-row owner/tenant clause.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authz-tenant'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-4',
    expected_behavior:
      'Tenant scope on queries is derived from the authenticated session, not from client-provided parameters.',
    required_evidence_kinds: ['static_code', 'scanner'],
    owning_agent_ids: ['authz-tenant'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-5',
    expected_behavior:
      'Sensitive tables have ENABLE ROW LEVEL SECURITY set.',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['supabase-rls'],
    phase_2_active_supported: true,
    required_scenario_set: ['rls_on', 'rls_off'],
  },
  {
    control_id: 'cc-11-6',
    expected_behavior:
      'Policies on sensitive tables do not use USING (true).',
    required_evidence_kinds: ['static_code'],
    owning_agent_ids: ['supabase-rls'],
    phase_2_active_supported: true,
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
    phase_2_active_supported: true,
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
    phase_2_active_supported: true,
  },
  // Phase 2 step 2.07d: PostgREST query-surface checks (active only).
  {
    control_id: 'cc-11-13a',
    expected_behavior:
      'PostgREST OpenAPI spec at /rest/v1/ does not advertise sensitive tables to non-admin actors.',
    required_evidence_kinds: ['active_validation'],
    owning_agent_ids: ['sandbox-runner'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-13b',
    expected_behavior:
      'PostgREST select=* does not return declared-private columns to non-admin actors.',
    required_evidence_kinds: ['active_validation'],
    owning_agent_ids: ['sandbox-runner'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-13c',
    expected_behavior:
      'PostgREST neq / or filters cannot return cross-tenant rows to a tenant-scoped actor.',
    required_evidence_kinds: ['active_validation'],
    owning_agent_ids: ['sandbox-runner'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-13d',
    expected_behavior:
      'PostgREST foreign-table embeds do not leak cross-tenant rows or sensitive columns.',
    required_evidence_kinds: ['active_validation'],
    owning_agent_ids: ['sandbox-runner'],
    phase_2_active_supported: true,
  },
  {
    control_id: 'cc-11-13e',
    expected_behavior:
      'PostgREST filter on declared-private column does not return rows to non-admin actor.',
    required_evidence_kinds: ['active_validation'],
    owning_agent_ids: ['sandbox-runner'],
    phase_2_active_supported: true,
  },
];

export function findControl(id: string): ControlDefinition | undefined {
  return CONTROLS.find((c) => c.control_id === id);
}
