import { describe, expect, it } from 'vitest';

import {
  asPromptTemplateId,
  type PromptTemplateId,
} from './prompt-template.js';
import { isErr, isOk } from './result.js';
import type { SanitizedMessage } from './sanitized-message.js';

describe('SanitizedMessage brand', () => {
  it('raw string cannot be assigned to SanitizedMessage at compile time', () => {
    // The `@ts-expect-error` is load-bearing: if the brand stops working
    // (e.g. `__brand` field removed), this assignment compiles and the
    // directive becomes "unused" — typecheck fails.
    // @ts-expect-error — raw string is not a SanitizedMessage
    const _bad: SanitizedMessage = 'unscrubbed';
    void _bad;
  });

  it('SanitizedMessage is assignable TO a string (one-way brand)', () => {
    // Construct a SanitizedMessage through the only documented chokepoint:
    // the sanitization helper. Use a value with no secret-shaped content
    // so it round-trips unchanged.
    // The actual mint lives in `src/ai/sanitization.ts`; here we only
    // assert the widening direction at the type level.
    // (Cast is intentional and confined to this assertion test.)
    const m = 'hello' as SanitizedMessage;
    const widened: string = m;
    expect(widened).toBe('hello');
  });

  it('there is no exported factory in sanitized-message.ts', async () => {
    const mod = (await import('./sanitized-message.js')) as Record<
      string,
      unknown
    >;
    // `asSanitizedMessage` was removed in step 02c per user direction:
    // the brand may only be minted by sanitization helpers, not by an
    // "easy raw constructor."
    expect(mod['asSanitizedMessage']).toBeUndefined();
  });
});

describe('PromptTemplateId brand', () => {
  it('factory accepts the documented template ids', () => {
    const ids = [
      'templates.project_overview',
      'templates.user_flows',
      'templates.data_handling',
      'templates.auth_model',
    ];
    for (const id of ids) {
      const r = asPromptTemplateId(id);
      expect(isOk(r)).toBe(true);
    }
  });

  it('factory rejects free-form text', () => {
    const r = asPromptTemplateId('please tell me about the project');
    expect(isErr(r)).toBe(true);
  });

  it('factory rejects empty string', () => {
    const r = asPromptTemplateId('');
    expect(isErr(r)).toBe(true);
  });

  it('raw string cannot be assigned to PromptTemplateId at compile time', () => {
    // @ts-expect-error — raw string is not a PromptTemplateId
    const _bad: PromptTemplateId = 'templates.project_overview';
    void _bad;
  });
});
