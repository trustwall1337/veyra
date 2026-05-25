/**
 * Pass-1 assertion predicates for the authz-tenant agent.
 *
 * Pure functions of `ScanFact[]`. Predicates dispatch on
 * `payload.rule_id` from Semgrep facts and on `element_kind` for
 * schema_element facts (revision §10 step 11 row + §4.1 Pass-1 rule).
 * No `Hypothesis[]` parameter; constraint 10 enforced at the type
 * level.
 */

import type { Finding } from '../../types/finding.js';
import type { ScanFact } from '../../types/scan-fact.js';

const UNCERTAINTY_NOTE =
  'static authz detection; server-side authorization via SSR/middleware or row-level policies may exist but not be detected';

const SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  'users',
  'accounts',
  'orders',
  'tenants',
  'invoices',
  'payments',
  'customers',
  'subscriptions',
  'documents',
]);

const DIRECT_OBJECT_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.direct-object-access-by-id',
  'authz.direct-object-access-by-id',
]);

const CLIENT_TENANT_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.client-tenant-id',
  'authz.client-tenant-id',
]);

const ALL_AUTHENTICATED_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.write-without-tenant-check',
  'authz.write-without-tenant-check',
]);

function ruleIdOf(fact: ScanFact): string | undefined {
  if (fact.source.kind !== 'scanner_match') return undefined;
  return fact.source.payload.rule_id;
}

function sensitiveTablesFromFacts(
  facts: readonly ScanFact[],
): ReadonlySet<string> {
  // Trust step 09b's schema-element facts when present, otherwise fall
  // back to the canonical name list.
  const fromFacts: string[] = [];
  for (const f of facts) {
    if (f.source.kind !== 'schema_element') continue;
    if (f.source.element_kind !== 'table') continue;
    try {
      const payload = JSON.parse(
        f.source.payload?.sanitized_excerpt ?? '{}',
      ) as { name?: string };
      if (typeof payload.name === 'string') fromFacts.push(payload.name);
    } catch {
      // ignore
    }
  }
  if (fromFacts.length > 0) return new Set(fromFacts);
  return SENSITIVE_NAMES;
}

/**
 * cc-11-3: direct-object-access on a sensitive table.
 *
 * Per retro-11b f3: a Semgrep direct-object-access hit alone does NOT
 * justify `likely_issue` — the predicate requires corroboration from
 * either (a) an explicit `schema_element/table` ScanFact whose name
 * matches the excerpt, or (b) the canonical sensitive-name set from
 * the project's deterministic name list. Without table corroboration,
 * the hit becomes a `coverage_gap` so the reviewer is prompted to
 * check the table sensitivity manually rather than the predicate
 * over-classifying.
 */
export function predicateDirectObjectAccess(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const tableFactById = new Map<string, string>();
  for (const f of facts) {
    if (f.source.kind !== 'schema_element') continue;
    if (f.source.element_kind !== 'table') continue;
    const name = f.source.name;
    if (typeof name === 'string' && name.length > 0) {
      const bare = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name;
      tableFactById.set(bare, f.fact_id);
      tableFactById.set(name, f.fact_id);
    }
  }
  const schemaTableNames = new Set(tableFactById.keys());
  const hasSchemaFacts = schemaTableNames.size > 0;

  const out: Finding[] = [];
  for (const f of facts) {
    const id = ruleIdOf(f);
    if (id === undefined || !DIRECT_OBJECT_RULE_IDS.has(id)) continue;
    const excerpt =
      f.source.kind === 'scanner_match'
        ? f.source.payload.sanitized_excerpt
        : '';
    // Prefer schema_element evidence; fall back to canonical name set.
    const candidatePool = hasSchemaFacts ? schemaTableNames : SENSITIVE_NAMES;
    const tableHit = Array.from(candidatePool).find((name) =>
      new RegExp(`['"\`]${name}['"\`]`).test(excerpt),
    );
    if (tableHit === undefined) {
      // No table corroboration → coverage_gap, not likely_issue.
      out.push({
        id: `cc-11-3-coverage-gap-${f.fact_id}`,
        control_id: 'cc-11-3',
        finding_type: 'coverage_gap',
        evidence_strength: 'low',
        reproducibility: 'manual_review_required',
        review_action: 'review_before_launch',
        blast_radius: 'tenant_data',
        title: 'Direct-object-access rule fired without table corroboration',
        summary: `Semgrep rule "${id}" matched but no schema_element table or canonical sensitive-name match was found in the excerpt. Predicate could not confirm the access target is sensitive. Needs human review. ${UNCERTAINTY_NOTE}.`,
        evidence_refs: [f.fact_id],
      });
      continue;
    }
    const evidenceRefs = [f.fact_id];
    const tableFactId = tableFactById.get(tableHit);
    if (tableFactId !== undefined) evidenceRefs.push(tableFactId);
    out.push({
      id: `cc-11-3-${f.fact_id}`,
      control_id: 'cc-11-3',
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'tenant_data',
      title: `Direct-object access by id on sensitive table "${tableHit}"`,
      summary: `Predicate cc-11-3 fired on Semgrep rule "${id}" against table "${tableHit}". Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: evidenceRefs,
      suggested_test_ids: [
        'GET /api/<sensitive>/:id as user_b should return 403',
      ],
    });
  }
  return out;
}

/** cc-11-4: client-provided tenant scope used in a query. */
export function predicateClientTenantId(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const out: Finding[] = [];
  for (const f of facts) {
    const id = ruleIdOf(f);
    if (id === undefined || !CLIENT_TENANT_RULE_IDS.has(id)) continue;
    out.push({
      id: `cc-11-4-${f.fact_id}`,
      control_id: 'cc-11-4',
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'tenant_data',
      title: 'Client-provided tenant identifier used in a query without server-side validation',
      summary: `Predicate cc-11-4 fired on Semgrep rule "${id}". Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [f.fact_id],
      suggested_test_ids: [
        'GET /<page>?tenant_id=<other> as user_a should return 403 or empty',
      ],
    });
  }
  return out;
}

/**
 * cc-11-9: write endpoint that intersects with an authz-side
 * all-authenticated policy. Fires when both signals are present.
 */
export function predicateCrossTenantWriteRisk(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const writeFacts = facts.filter((f) => {
    const id = ruleIdOf(f);
    return id !== undefined && ALL_AUTHENTICATED_RULE_IDS.has(id);
  });
  if (writeFacts.length === 0) return [];

  // Look for a corroborating schema_element policy fact whose
  // sanitized_excerpt indicates TO authenticated with no per-row check.
  const broadPolicy = facts.find((f) => {
    if (f.source.kind !== 'schema_element') return false;
    if (f.source.element_kind !== 'policy') return false;
    try {
      const payload = JSON.parse(
        f.source.payload?.sanitized_excerpt ?? '{}',
      ) as { role?: string; using_expr?: string };
      const roles = (payload.role ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase());
      if (!roles.includes('authenticated')) return false;
      const expr = (payload.using_expr ?? '').toLowerCase();
      const hasPerRow =
        expr.includes('auth.') ||
        expr.includes('current_setting') ||
        (expr.includes('=') && expr !== 'true');
      return !hasPerRow;
    } catch {
      return false;
    }
  });
  if (broadPolicy === undefined) return [];

  return writeFacts.map((wf) => ({
    id: `cc-11-9-cross-tenant-${wf.fact_id}`,
    control_id: 'cc-11-9',
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'fix_before_launch',
    blast_radius: 'tenant_data',
    title: 'Write endpoint corroborated by an all-authenticated policy without per-row check',
    summary: `Predicate cc-11-9 (authz-tenant) fired. A Semgrep write-without-tenant-check fact and a Supabase policy granting authenticated without per-row scope both appear. Needs human review. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [wf.fact_id, broadPolicy.fact_id],
  }));
}

/**
 * Coverage gap when no sensitive-table facts are present at all
 * (supabase-rls did not run or produced nothing). The cc-11-3 / cc-11-4
 * predicates can still fire on Semgrep facts alone; this gap signals
 * the absence of corroborating schema data.
 */
export function authzCoverageGaps(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const anyTable = facts.some(
    (f) =>
      f.source.kind === 'schema_element' && f.source.element_kind === 'table',
  );
  if (anyTable) return [];
  return [
    {
      id: 'cc-11-3-coverage-gap-no-tables',
      control_id: 'cc-11-3',
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'tenant_data',
      title: 'Tenant-isolation predicates ran without schema-element facts',
      summary: `No schema_element table facts were observed in scan-facts.json; supabase-rls (09b) may not have produced its output for this scan. Negative tests should be added. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [],
    },
  ];
}
