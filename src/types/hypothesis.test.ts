import { describe, expect, it } from 'vitest';

import {
  assertExhaustiveHypothesisConfidence,
  assertExhaustiveProposedFindingType,
  type HypothesisConfidence,
  type ProposedFindingType,
} from './hypothesis.js';

function describeProposed(t: ProposedFindingType): string {
  switch (t) {
    case 'likely_issue':
      return 'likely_issue';
    case 'informational':
      return 'informational';
    default:
      return assertExhaustiveProposedFindingType(t);
  }
}

function describeConfidence(c: HypothesisConfidence): string {
  switch (c) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return assertExhaustiveHypothesisConfidence(c);
  }
}

describe('ProposedFindingType exhaustiveness', () => {
  it('handles likely_issue and informational, excludes confirmed_issue', () => {
    const samples: ProposedFindingType[] = ['likely_issue', 'informational'];
    for (const t of samples) {
      expect(describeProposed(t)).toBe(t);
    }
    // The @ts-expect-error directives below are the load-bearing
    // assertions: if any of these assignments would actually compile,
    // the directive becomes "unused" and `pnpm typecheck` fails. AI is
    // forbidden from proposing these classifications per revision §8 #7.
    // The values themselves are unused at runtime — the type system is
    // the test.
    // @ts-expect-error — AI cannot propose confirmed_issue
    const _forbiddenConfirmed: ProposedFindingType = 'confirmed_issue';
    // @ts-expect-error — AI cannot propose missing_evidence
    const _forbiddenMissing: ProposedFindingType = 'missing_evidence';
    // @ts-expect-error — AI cannot propose coverage_gap
    const _forbiddenGap: ProposedFindingType = 'coverage_gap';
    void _forbiddenConfirmed;
    void _forbiddenMissing;
    void _forbiddenGap;
  });
});

describe('HypothesisConfidence exhaustiveness', () => {
  it('every confidence level has a handler', () => {
    const samples: HypothesisConfidence[] = ['low', 'medium', 'high'];
    for (const c of samples) {
      expect(describeConfidence(c)).toBe(c);
    }
  });
});
