/**
 * Tier 3 of the three-tier report: Active validation outcomes.
 *
 * Phase 1 placeholder. Phase 2 fills this section with
 * `proven_denial` / `proven_allowed` / `inconclusive` per
 * (control_id, variant_id).
 */

export const ACTIVE_OUTCOMES_HEADING = '## Active validation outcomes';

export function renderActiveOutcomesSection(): string {
  return `${ACTIVE_OUTCOMES_HEADING}\n\nActive validation tests were not run in this scan. This tier is filled by Phase 2 when sandbox tests are run against synthetic identities.`;
}
