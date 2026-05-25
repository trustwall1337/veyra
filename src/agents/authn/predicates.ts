/**
 * Pass-1 assertion predicates for the authn agent.
 *
 * Pure functions of `ScanFact[]`. Each predicate dispatches on
 * `payload.rule_id` from Semgrep scanner_match facts (revision §3.1,
 * step 07b). No `Hypothesis[]` parameter; constraint 10 enforced at
 * the type level.
 */

import type { Finding } from '../../types/finding.js';
import type { ScanFact } from '../../types/scan-fact.js';

const UNCERTAINTY_NOTE =
  'static authn detection; server-side checks via SSR/middleware or framework conventions may exist but not be detected';

// Rule-id namespaces the predicates dispatch on. Adding a new pattern
// = new Semgrep rule + new id here; no shared-type edits.
const CLIENT_ONLY_GUARD_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.client-side-only-guard',
  'authn.client-side-only-guard',
]);

const ADMIN_ROUTE_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.admin-route',
  'authn.admin-route-no-server-check',
]);

const SERVER_ROLE_CHECK_RULE_IDS: ReadonlySet<string> = new Set([
  'rules.authz.server-role-check',
  'authn.server-role-check',
]);

function ruleIdOf(fact: ScanFact): string | undefined {
  if (fact.source.kind !== 'scanner_match') return undefined;
  return fact.source.payload.rule_id;
}

function clientGuardFacts(facts: readonly ScanFact[]): readonly ScanFact[] {
  return facts.filter((f) => {
    const id = ruleIdOf(f);
    return id !== undefined && CLIENT_ONLY_GUARD_RULE_IDS.has(id);
  });
}

function adminRouteFacts(facts: readonly ScanFact[]): readonly ScanFact[] {
  return facts.filter((f) => {
    const id = ruleIdOf(f);
    return id !== undefined && ADMIN_ROUTE_RULE_IDS.has(id);
  });
}

function hasServerRoleCheckFact(facts: readonly ScanFact[]): boolean {
  return facts.some((f) => {
    const id = ruleIdOf(f);
    return id !== undefined && SERVER_ROLE_CHECK_RULE_IDS.has(id);
  });
}

/** cc-11-1: client-side guard alone. */
export function predicateClientOnlyProtection(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const guards = clientGuardFacts(facts);
  if (guards.length === 0) return [];
  const out: Finding[] = [];
  for (const f of guards) {
    out.push({
      id: `cc-11-1-${f.fact_id}`,
      control_id: 'cc-11-1',
      finding_type: 'likely_issue',
      evidence_strength: 'medium',
      reproducibility: 'static',
      review_action: 'fix_before_launch',
      blast_radius: 'user_data',
      title: 'Client-side route guard appears to be the only authentication gate',
      summary: `Predicate cc-11-1 fired on Semgrep rule "${ruleIdOf(f) ?? '<unknown>'}". No server-side check fact was observed. Needs human review. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [f.fact_id],
    });
  }
  return out;
}

/** cc-11-2: admin route without a server-side role check. */
export function predicateAdminWithoutServerCheck(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const adminRoutes = adminRouteFacts(facts);
  if (adminRoutes.length === 0) return [];
  if (hasServerRoleCheckFact(facts)) return [];
  return adminRoutes.map((f) => ({
    id: `cc-11-2-${f.fact_id}`,
    control_id: 'cc-11-2',
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'fix_before_launch',
    blast_radius: 'admin_access',
    title: 'Admin route without a detectable server-side role check',
    summary: `Predicate cc-11-2 fired on Semgrep rule "${ruleIdOf(f) ?? '<unknown>'}". No server-role-check fact was observed in the scan-facts set. Needs human review. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [f.fact_id],
  }));
}

/** Coverage gap when no relevant scanner facts were observed. */
export function authnCoverageGaps(
  facts: readonly ScanFact[],
): readonly Finding[] {
  const anyRelevant =
    clientGuardFacts(facts).length > 0 ||
    adminRouteFacts(facts).length > 0 ||
    hasServerRoleCheckFact(facts);
  if (anyRelevant) return [];
  return [
    {
      id: 'cc-11-1-coverage-gap-no-authn-facts',
      control_id: 'cc-11-1',
      finding_type: 'coverage_gap',
      evidence_strength: 'low',
      reproducibility: 'manual_review_required',
      review_action: 'review_before_launch',
      blast_radius: 'user_data',
      title: 'Authentication gating was not checked (no relevant scanner facts)',
      summary: `No scanner_match facts in the authn rule_id set were observed. Negative tests should be added once Semgrep authn rules are in place. ${UNCERTAINTY_NOTE}.`,
      evidence_refs: [],
    },
  ];
}
