import { describe, expect, it } from 'vitest';

import { asProviderId, type ProviderId } from '../types/identity.js';
import { isErr, isOk } from '../types/result.js';
import type { SanitizedMessage } from '../types/sanitized-message.js';

import type { AiMessage, AiProvider, AiRequest } from './types.js';

describe('AiMessage brand', () => {
  it('raw string cannot be assigned to AiMessage.content at compile time', () => {
    // The brand on `SanitizedMessage` is the load-bearing constraint —
    // if raw strings ever flow into an AI prompt, the @ts-expect-error
    // becomes unused and `pnpm typecheck` fails.
    // @ts-expect-error — raw string is not a SanitizedMessage
    const _bad: AiMessage = { role: 'user', content: 'unscrubbed text' };
    void _bad;
  });

  it('AiRequest.system also requires SanitizedMessage', () => {
    // @ts-expect-error — raw string is not a SanitizedMessage
    const _bad: AiRequest = {
      model_id: 'm',
      system: 'plain prompt',
      messages: [],
      max_output_tokens: 100,
    };
    void _bad;
  });
});

describe('AiProvider.id brand', () => {
  it('AiProvider.id must be a ProviderId, not a raw string', () => {
    // @ts-expect-error — raw string is not a ProviderId
    const _bad: AiProvider = {
      id: 'anthropic',
      complete: () => Promise.reject(new Error('stub')),
    };
    void _bad;
  });

  it('ProviderId factory accepts kebab-case provider ids', () => {
    const r = asProviderId('anthropic');
    expect(isOk(r)).toBe(true);
  });

  it('ProviderId factory rejects empty string', () => {
    const r = asProviderId('');
    expect(isErr(r)).toBe(true);
  });

  it('ProviderId widens to string', () => {
    const r = asProviderId('anthropic');
    if (isErr(r)) throw new Error('id');
    const id: ProviderId = r.value;
    const widened: string = id;
    expect(widened).toBe('anthropic');
  });

  it('SanitizedMessage is structurally compatible with string at runtime', () => {
    // Sanity check that the brand is purely a compile-time tag — at
    // runtime, a SanitizedMessage IS a string.
    const m = 'scrubbed' as SanitizedMessage;
    expect(typeof m).toBe('string');
  });
});
