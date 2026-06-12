import { describe, expect, it } from 'vitest';

import { asProviderId } from '../types/identity.js';

import { constructAiProvider } from './ai-provider-factory.js';

function providerId(s: string) {
  const r = asProviderId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('constructAiProvider (codex retro 2.04-openai-not-wired)', () => {
  it('constructs an Anthropic provider when id === anthropic', async () => {
    const p = await constructAiProvider({
      providerId: providerId('anthropic'),
      envReader: (n) => (n === 'ANTHROPIC_API_KEY' ? 'fake-anthropic-key' : undefined),
    });
    expect(p.id).toBe('anthropic');
    expect(typeof p.complete).toBe('function');
  });

  it('constructs an OpenAI provider when id === openai', async () => {
    const p = await constructAiProvider({
      providerId: providerId('openai'),
      envReader: (n) => (n === 'OPENAI_API_KEY' ? 'fake-openai-key' : undefined),
    });
    expect(p.id).toBe('openai');
    expect(typeof p.complete).toBe('function');
  });

  it('throws when constructAiProvider is asked for the loop-only Bedrock id', async () => {
    // Step 31d: Bedrock exposes the agentic-loop `AiDriver` shape only via
    // `constructLoopDriver`. `constructAiProvider` (the legacy non-loop
    // entry) explicitly routes Bedrock to that error.
    await expect(
      constructAiProvider({
        providerId: providerId('bedrock'),
        envReader: () => undefined,
      }),
    ).rejects.toThrow(/AiDriver|constructLoopDriver/);
  });

  it('throws on a genuinely unknown provider id', async () => {
    await expect(
      constructAiProvider({
        providerId: providerId('frobnicate'),
        envReader: () => undefined,
      }),
    ).rejects.toThrow(/not wired/);
  });
});
