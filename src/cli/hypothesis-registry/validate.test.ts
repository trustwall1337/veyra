import { describe, expect, it } from 'vitest';

import {
  containsClaimVocabularyToken,
  containsClassificationStringToken,
} from './validate.js';

describe('V4 / V6 — classification + claim string-token walkers', () => {
  it('classification-string-token catches the 10 tokens at any depth', () => {
    for (const token of [
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
    ]) {
      expect(
        containsClassificationStringToken({ statement: `prefix ${token} suffix` }),
      ).toBe(true);
      expect(
        containsClassificationStringToken({ deeply: { nested: [`${token}`] } }),
      ).toBe(true);
    }
  });

  it('claim-vocab catches the canonical claim tokens with word boundaries', () => {
    expect(containsClaimVocabularyToken('this app is secure')).toBe(true);
    expect(containsClaimVocabularyToken('SAFE in production')).toBe(true);
    expect(containsClaimVocabularyToken('compliant with SOC2')).toBe(true);
    expect(containsClaimVocabularyToken('a vulnerable IDOR pattern')).toBe(true);
    expect(containsClaimVocabularyToken('exploit chain')).toBe(true);
    expect(containsClaimVocabularyToken('launch-blocker risk')).toBe(true);
    expect(containsClaimVocabularyToken('launch blocker risk')).toBe(true);
    expect(containsClaimVocabularyToken('CONFIRMED vulnerability')).toBe(true);
    expect(containsClaimVocabularyToken('proven_idor pattern')).toBe(true);
    expect(containsClaimVocabularyToken('proven-against the spec')).toBe(true);
  });

  it('claim-vocab is word-boundary-sensitive (insecure does NOT match secure)', () => {
    // \bsecure\b requires the token to be a standalone word. "insecure"
    // glues `in` to `secure` without an internal word boundary, so the
    // walker does NOT match. This is intentional: the trust-model concern
    // is CLAIM vocabulary (a positive verdict), not all letter
    // combinations that happen to contain `secure`.
    expect(containsClaimVocabularyToken('insecure-by-default')).toBe(false);
    // But the same word with a boundary on both sides DOES match.
    expect(containsClaimVocabularyToken('this is secure-by-default')).toBe(true);
  });

  it('benign metadata strings pass both walkers', () => {
    const ok = {
      statement: 'observed multi-tenant app with admin and member roles',
      confidence: 'medium',
    };
    expect(containsClassificationStringToken(ok)).toBe(false);
    expect(containsClaimVocabularyToken(ok)).toBe(false);
  });
});
