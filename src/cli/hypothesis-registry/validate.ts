/**
 * Hypothesis-registry prewrite scalar-string guards (Phase 3 / Step 40e).
 *
 * Two walkers, BOTH applied to `args.statement` + `args.statement_addendum`
 * BEFORE the registry mutates (Decision D Layer 2 + Decision F per
 * codex 40e-plan-04 [APPLIED]):
 *
 *  - `containsClassificationStringToken` — catches the 10 classification
 *    tokens 40d defined inline; here exported for reuse.
 *  - `containsClaimVocabularyToken` — catches output-language CLAIM
 *    vocabulary forbidden in audit metadata (CLAUDE.md §Output language).
 */

const CLASSIFICATION_STRING_TOKENS: readonly string[] = [
  'finding_type',
  'review_action',
  'evidence_strength',
  'blast_radius',
  'reproducibility',
  'fix_before_launch',
  'review_before_launch',
  'confirmed_issue',
  'likely_issue',
  'coverage_gap',
];

/**
 * Output-language claim tokens — word-boundary-anchored so a benign
 * compound like `"insecure-default"` does not match `"secure"`. The
 * trust-model concern is CLAIM vocabulary in observational metadata.
 */
const CLAIM_VOCABULARY_PATTERNS: readonly RegExp[] = [
  /\bsecure\b/i,
  /\bsafe\b/i,
  /\bcompliant\b/i,
  /\bvulnerable\b/i,
  /\bexploit\b/i,
  /\blaunch[-\s]?blocker\b/i,
  /\bconfirmed\b/i,
  /\bproven[-_a-z]*\b/i,
];

/**
 * Recursive walk of `value`; returns `true` if any string scalar (at
 * any depth) contains any of the 10 classification-string tokens.
 * Exported for reuse outside the prewrite guard (test surface).
 */
export function containsClassificationStringToken(value: unknown): boolean {
  if (typeof value === 'string') {
    for (const token of CLASSIFICATION_STRING_TOKENS) {
      if (value.includes(token)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsClassificationStringToken(item));
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (containsClassificationStringToken(nested)) return true;
    }
  }
  return false;
}

/**
 * Recursive walk; returns `true` if any string scalar contains a
 * claim-vocabulary token. Promoted from a post-artifact lint to a
 * prewrite guard per codex 40e-plan-04 [APPLIED].
 */
export function containsClaimVocabularyToken(value: unknown): boolean {
  if (typeof value === 'string') {
    for (const pattern of CLAIM_VOCABULARY_PATTERNS) {
      if (pattern.test(value)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsClaimVocabularyToken(item));
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (containsClaimVocabularyToken(nested)) return true;
    }
  }
  return false;
}
