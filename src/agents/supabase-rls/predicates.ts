/**
 * Pass-1 assertion predicates for the supabase-rls agent.
 *
 * Per revision §4.1: each predicate is a pure function of
 * `ScanFact[]` + (optional) `declared-context`. It returns the
 * Finding(s) that fire on those facts, or empty.
 *
 * Hypotheses are NOT a parameter. Adding `Hypothesis[]` to any
 * predicate's signature would let AI absence change a baseline
 * finding's classification — forbidden by constraint 10.
 */

import type { Finding } from '../../types/finding.js';
import {
  asConnectorId,
  type ConnectorId,
} from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';

import { classifyTable } from './heuristics.js';

// Retro-09b f4: bucket fact validators must check the connector_id,
// not just the tool name. A different connector could expose a tool
// also named `list_storage_buckets`; only the Supabase one supplies
// Supabase bucket state. The id is minted once at module load.
const SUPABASE_CONNECTOR_ID: ConnectorId = (() => {
  const r = asConnectorId('supabase');
  if (!r.ok) throw new Error(`bug: ${r.error.message}`);
  return r.value;
})();

const UNCERTAINTY_NOTE =
  'regex parser; complex SQL may be missed (CTEs, DO $$ blocks, multi-statement policies, user-defined functions)';

interface TableFact {
  readonly fact_id: string;
  readonly schema: string;
  readonly name: string;
  readonly rls_enabled: boolean;
}

interface PolicyFact {
  readonly fact_id: string;
  readonly name: string;
  readonly schema: string;
  readonly table: string;
  readonly operation: string;
  readonly role?: string;
  readonly using_expr?: string;
  readonly with_check_expr?: string;
}

interface BucketFact {
  readonly fact_id: string;
  readonly bucket_id: string;
  readonly bucket_name: string;
  readonly public: boolean;
  readonly policies: readonly { role: string; operation: string; name: string }[];
}

function unpackTableFact(fact: ScanFact): TableFact | null {
  if (fact.source.kind !== 'schema_element') return null;
  if (fact.source.element_kind !== 'table') return null;
  try {
    const payload = JSON.parse(
      fact.source.payload?.sanitized_excerpt ?? '{}',
    ) as { schema?: string; name?: string; rls_enabled?: boolean };
    if (typeof payload.schema !== 'string' || typeof payload.name !== 'string') {
      return null;
    }
    return {
      fact_id: fact.fact_id,
      schema: payload.schema,
      name: payload.name,
      rls_enabled: payload.rls_enabled === true,
    };
  } catch {
    return null;
  }
}

function unpackPolicyFact(fact: ScanFact): PolicyFact | null {
  if (fact.source.kind !== 'schema_element') return null;
  if (fact.source.element_kind !== 'policy') return null;
  try {
    const payload = JSON.parse(
      fact.source.payload?.sanitized_excerpt ?? '{}',
    ) as {
      name?: string;
      schema?: string;
      table?: string;
      operation?: string;
      role?: string;
      using_expr?: string;
      with_check_expr?: string;
    };
    if (
      typeof payload.name !== 'string' ||
      typeof payload.schema !== 'string' ||
      typeof payload.table !== 'string' ||
      typeof payload.operation !== 'string'
    ) {
      return null;
    }
    return {
      fact_id: fact.fact_id,
      name: payload.name,
      schema: payload.schema,
      table: payload.table,
      operation: payload.operation,
      ...(typeof payload.role === 'string' ? { role: payload.role } : {}),
      ...(typeof payload.using_expr === 'string'
        ? { using_expr: payload.using_expr }
        : {}),
      ...(typeof payload.with_check_expr === 'string'
        ? { with_check_expr: payload.with_check_expr }
        : {}),
    };
  } catch {
    return null;
  }
}

function unpackBucketFact(fact: ScanFact): BucketFact | null {
  if (fact.source.kind !== 'mcp_response') return null;
  if (fact.source.tool !== 'list_storage_buckets') return null;
  // Retro-09b f4: only accept bucket facts produced by the Supabase
  // connector. A future connector exposing the same tool name (e.g.
  // a forked Supabase fork or a competing Storage provider) must not
  // be misclassified as Supabase bucket evidence.
  if (fact.source.connector_id !== SUPABASE_CONNECTOR_ID) return null;
  try {
    const payload = JSON.parse(
      fact.source.payload?.sanitized_excerpt ?? '{}',
    ) as {
      id?: string;
      name?: string;
      public?: boolean;
      policies?: readonly { role?: string; operation?: string; name?: string }[];
    };
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string') {
      return null;
    }
    return {
      fact_id: fact.fact_id,
      bucket_id: payload.id,
      bucket_name: payload.name,
      public: payload.public === true,
      policies: (payload.policies ?? [])
        .filter(
          (p): p is { role: string; operation: string; name: string } =>
            typeof p.role === 'string' &&
            typeof p.operation === 'string' &&
            typeof p.name === 'string',
        )
        .map((p) => ({ role: p.role, operation: p.operation, name: p.name })),
    };
  } catch {
    return null;
  }
}

function looksOpen(expr: string | undefined): boolean {
  return (
    expr?.replace(/\s+/g, ' ').trim().toLowerCase() === 'true'
  );
}

function hasPerRowCheck(expr: string | undefined): boolean {
  if (expr === undefined) return false;
  const lower = expr.toLowerCase();
  return (
    lower.includes('auth.') ||
    lower.includes('current_setting') ||
    (lower.includes('=') && lower !== 'true')
  );
}

/** cc-11-5: RLS missing on sensitive table. Pure of `ScanFact[]`. */
export function predicateRlsMissing(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const out: Finding[] = [];
  for (const fact of facts) {
    const t = unpackTableFact(fact);
    if (t === null) continue;
    if (t.schema !== 'public') continue;
    if (t.rls_enabled) continue;
    const c = classifyTable(t.name);
    if (c.matched_via === 'none') continue;
    out.push({
      id: `cc-11-5-${t.schema}.${t.name}`,
      control_id: 'cc-11-5',
      finding_type: 'likely_issue',
      evidence_strength: c.strength,
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius:
        t.name === 'users' || t.name === 'accounts'
          ? 'user_data'
          : 'tenant_data',
      title: `RLS appears missing on sensitive table "${t.schema}.${t.name}"`,
      summary: `Predicate cc-11-5 fired on ${t.schema}.${t.name} (${c.matched_via}). Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [t.fact_id],
    });
  }
  return out;
}

/** cc-11-6: USING (true) on sensitive table. */
export function predicateBroadPolicy(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const tables = facts
    .map(unpackTableFact)
    .filter((t): t is TableFact => t !== null);
  const sensitiveByName = new Map(tables.map((t) => [t.name, t]));

  const out: Finding[] = [];
  for (const fact of facts) {
    const p = unpackPolicyFact(fact);
    if (p === null) continue;
    if (!looksOpen(p.using_expr)) continue;
    const c = classifyTable(p.table);
    if (c.matched_via === 'none') continue;
    const tableFact = sensitiveByName.get(p.table);
    const refs = tableFact !== undefined ? [p.fact_id, tableFact.fact_id] : [p.fact_id];
    out.push({
      id: `cc-11-6-${p.schema}.${p.table}-${p.name}`,
      control_id: 'cc-11-6',
      finding_type: 'likely_issue',
      evidence_strength: c.strength,
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius:
        p.table === 'users' || p.table === 'accounts'
          ? 'user_data'
          : 'tenant_data',
      title: `Open policy "USING (true)" on sensitive table "${p.schema}.${p.table}"`,
      summary: `Predicate cc-11-6 fired on policy "${p.name}". Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: refs,
    });
  }
  return out;
}

/** cc-11-9: policy granting to authenticated without per-row check. */
export function predicateAllAuthenticated(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const out: Finding[] = [];
  for (const fact of facts) {
    const p = unpackPolicyFact(fact);
    if (p === null) continue;
    if (p.role === undefined) continue;
    const roles = p.role.split(',').map((s) => s.trim().toLowerCase());
    if (!roles.includes('authenticated')) continue;
    if (hasPerRowCheck(p.using_expr)) continue;
    const c = classifyTable(p.table);
    out.push({
      id: `cc-11-9-${p.schema}.${p.table}-${p.name}`,
      control_id: 'cc-11-9',
      finding_type: 'likely_issue',
      evidence_strength: c.matched_via === 'exact_name' ? 'high' : 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'tenant_data',
      title: `Policy grants ${p.operation} on "${p.schema}.${p.table}" to authenticated without a per-row check`,
      summary: `Predicate cc-11-9 fired on policy "${p.name}". Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [p.fact_id],
    });
  }
  return out;
}

/**
 * cc-11-12: public storage bucket with anon SELECT. Without bucket
 * facts (MCP not configured) emit a `coverage_gap` finding.
 */
export function predicatePublicBucket(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const buckets = facts
    .map(unpackBucketFact)
    .filter((b): b is BucketFact => b !== null);
  if (buckets.length === 0) {
    return [
      {
        id: 'cc-11-12-coverage-gap',
        control_id: 'cc-11-12',
        finding_type: 'coverage_gap',
        evidence_strength: 'low',
        reproducibility: 'manual_review_required',
        review_action: 'review_before_launch',
        blast_radius: 'private_files',
        title: 'Storage bucket state was not checked',
        summary:
          'No bucket facts were observed in scan-facts.json. Supabase MCP appears not configured; negative tests should be added once `--supabase-mcp <project_ref>` is set.',
        evidence_refs: [],
      },
    ];
  }
  const out: Finding[] = [];
  for (const b of buckets) {
    if (!b.public) continue;
    const anonSelect = b.policies.find(
      (p) => p.role.toLowerCase() === 'anon' && p.operation.toUpperCase() === 'SELECT',
    );
    if (anonSelect === undefined) continue;
    out.push({
      id: `cc-11-12-${b.bucket_id}`,
      control_id: 'cc-11-12',
      finding_type: 'likely_issue',
      evidence_strength: 'high',
      reproducibility: 'mcp_context',
      review_action: 'fix_before_launch',
      blast_radius: 'private_files',
      title: `Public storage bucket "${b.bucket_name}" with anonymous SELECT policy`,
      summary: `Predicate cc-11-12 fired on bucket "${b.bucket_name}" (policy "${anonSelect.name}"). Needs human review.`,
      evidence_refs: [b.fact_id],
    });
  }
  return out;
}
