/**
 * Pure readiness-status computation per step 14 rules.
 *
 *  - Any `confirmed_issue` + `review_action: fix_before_launch` → `launch_blocker`
 *  - Any `likely_issue` with `evidence_strength: high` AND `review_action: fix_before_launch` → `launch_blocker`
 *  - Any `coverage_gap` AND no contradicting evidence → `needs_review`
 *  - At least one supporting evidence item and no blocker / unresolved gap → `evidence_present`
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
