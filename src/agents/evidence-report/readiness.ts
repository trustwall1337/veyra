/**
 * Pure readiness-status computation per step 14 rules.
 *
 *  - Any `confirmed_issue` + `review_action: fix_before_launch` → `launch_blocker`
 *  - Any `likely_issue` with `evidence_strength: high` AND `review_action: fix_before_launch` → `launch_blocker`
 *  - Any `coverage_gap` AND no contradicting evidence → `needs_review`
 *  - At least one supporting evidence item and no blocker / unresolved gap → `evidence_present`
 *
 * Step 23 Bug E (option b): in the deterministic Phase 1 baseline,
 * no Pass-1 predicate emits positive evidence items (every predicate
 * emits negative findings: likely_issue / coverage_gap / confirmed_issue).
 * `evidence_present` is therefore unreachable in Phase 1 by design.
 * Phase 2's active validation produces positive evidence (e.g.
 * "negative test verified the role check returned 403") which is
 * what populates `evidence_present`. The user-facing report carries
 * this note in its executive summary so a reader does not read
 * `evidence_present: 0` as a defect of the deterministic scan.
 */

import type { ReadinessStatus } from '../../types/control-card.js';
import type { EvidenceItem } from '../../types/evidence.js';
import type { Finding } from '../../types/finding.js';

export function computeReadiness(input: {
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceItem[];
}): ReadinessStatus {
  const hasConfirmedBlocker = input.findings.some(
    (f) =>
      f.finding_type === 'confirmed_issue' &&
      f.review_action === 'fix_before_launch',
  );
  if (hasConfirmedBlocker) return 'launch_blocker';

  const hasHighLikelyBlocker = input.findings.some(
    (f) =>
      f.finding_type === 'likely_issue' &&
      f.evidence_strength === 'high' &&
      f.review_action === 'fix_before_launch',
  );
  if (hasHighLikelyBlocker) return 'launch_blocker';

  const hasCoverageGap = input.findings.some(
    (f) => f.finding_type === 'coverage_gap',
  );
  if (hasCoverageGap) return 'needs_review';

  if (input.evidence.length > 0) return 'evidence_present';

  return 'needs_review';
}
