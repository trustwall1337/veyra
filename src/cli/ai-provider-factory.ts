/**
 * AI provider runtime factory (step 2.04 codex retro
 * 2.04-openai-not-wired).
 *
 * The CLI's `--ai-provider <name>` flag validates the provider id
 * against the registry but did not construct a runtime AiProvider
 * instance. This factory closes that gap: given a validated
 * ProviderId + envReader, it constructs the right adapter
 * (Anthropic or OpenAI) and returns it for agent injection.
 *
 * Per FPP §2A: provider id is opaque (`ProviderId`-shaped). The
 * factory uses a registered-id lookup rather than a closed union;
 * adding a third provider (Gemini, Bedrock, local-llm) is a new
 * branch here PLUS the registry entry + the adapter file.
 */

import type { AiProvider } from '../ai/types.js';
import type { ProviderId } from '../types/identity.js';

export interface AiProviderFactoryDeps {
  readonly providerId: ProviderId;
  readonly envReader: (name: string) => string | undefined;
  readonly defaultModelId?: string;
}

export async function constructAiProvider(
  deps: AiProviderFactoryDeps,
): Promise<AiProvider> {
  const idStr = String(deps.providerId);
  if (idStr === 'anthropic') {
    const apiKey = deps.envReader('ANTHROPIC_API_KEY');
    const mod = await import('../ai/anthropic.js');
    return mod.createAnthropicProvider({
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(deps.defaultModelId !== undefined
        ? { defaultModelId: deps.defaultModelId }
        : {}),
    });
  }
  if (idStr === 'openai') {
    const apiKey = deps.envReader('OPENAI_API_KEY');
    const mod = await import('../ai/openai.js');
    return mod.createOpenAiProvider({
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(deps.defaultModelId !== undefined
        ? { defaultModelId: deps.defaultModelId }
        : {}),
    });
  }
  throw new Error(
    `constructAiProvider: provider id "${idStr}" is not wired. Register an adapter and extend the factory.`,
  );
}
