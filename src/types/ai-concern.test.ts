import { describe, expect, it } from 'vitest';

import {
  assertExhaustiveAIConcernCategory,
  type AIConcernCategory,
} from './ai-concern.js';

function describeCategory(c: AIConcernCategory): string {
  switch (c) {
    case 'no_predicate_fired':
      return 'no_predicate_fired';
    case 'insufficient_facts':
      return 'insufficient_facts';
    default:
      return assertExhaustiveAIConcernCategory(c);
  }
}

describe('AIConcernCategory exhaustiveness', () => {
  it('handles the two allowed categories, excludes predicate_contradicted', () => {
    const samples: AIConcernCategory[] = [
      'no_predicate_fired',
      'insufficient_facts',
    ];
    for (const c of samples) {
      expect(describeCategory(c)).toBe(c);
    }

    // Revision §4.2 rule 2: contradicted hypotheses go to assertions.json
    // only, never AIConcern. The @ts-expect-error is the load-bearing
    // assertion — if `'predicate_contradicted'` ever compiles into this
    // union, typecheck fails on the now-unused directive.
    // @ts-expect-error — predicate_contradicted is not a valid AIConcern category
    const _forbidden: AIConcernCategory = 'predicate_contradicted';
    void _forbidden;
  });
});
