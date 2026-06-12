/**
 * AI provider runtime factory.
 *
 * Two entry points share the registry — adding a third provider is one
 * branch in each function PLUS the registry entry + the adapter file:
 *
 *  - `constructAiProvider(...)` (legacy / Phase 2 non-loop callers): returns
 *    the legacy `AiProvider.complete(...)` shape used by the topo-sort
 *    hypothesis-disposition path.
 *  - `constructLoopDriver(...)` (Step 31d, Phase 3 agentic loop): returns
 *    `{ id, driver: AiDriver }`. The Bedrock branch is wired here; the
 *    agentic-loop entry calls `driver.proposeNext(...)` directly.
 *
 * Per FPP §2A: provider id is opaque (`ProviderId`-shaped). The factory uses
 * a registered-id lookup rather than a closed union.
 */

import * as fs from 'node:fs';

import type { AiProvider as LegacyAiProvider } from '../ai/types.js';
import {
  createBedrockProvider,
  recordedBedrockTransport,
  type BedrockStructuredResponse,
} from '../ai/bedrock/provider.js';
import { liveBedrockTransport } from '../ai/bedrock/transport-live.js';
import type { AiDriver } from '../core/orchestrator/agentic-loop.js';
import type { ProviderId } from '../types/identity.js';

export interface AiProviderFactoryDeps {
  readonly providerId: ProviderId;
  readonly envReader: (name: string) => string | undefined;
  readonly defaultModelId?: string;
}

/**
 * Step 31d codex §6.5-r2 MUST #5: the cross-provider default sentinel from
 * `scan-command.ts` DEFAULT_AI_MODEL. `validateAiOptions` fills this when the
 * user didn't pass `--ai-model`, so each provider's factory branch can detect
 * "no user-supplied model" and substitute a provider-shaped default. Mirrored
 * (not imported) to avoid a `cli/ai-provider-factory.ts` ↔ `cli/scan-command.ts`
 * import cycle; a structural test asserts the two stay in sync.
 */
const CROSS_PROVIDER_DEFAULT_MODEL_SENTINEL = 'claude-sonnet-4-6';
/** Bedrock-shaped EU inference-profile id used when no `--ai-model` is given. */
const BEDROCK_DEFAULT_MODEL = 'eu.anthropic.claude-sonnet-4-6';

/**
 * Legacy `AiProvider` constructor (kept for the Phase 2 hypothesis-disposition
 * / inference path that still uses `complete(request)`).
 */
export async function constructAiProvider(
  deps: AiProviderFactoryDeps,
): Promise<LegacyAiProvider> {
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
  if (idStr === 'bedrock') {
    throw new Error(
      'constructAiProvider: the Bedrock provider exposes the agentic-loop `AiDriver` shape only. Call `constructLoopDriver({ providerId: "bedrock", … })`.',
    );
  }
  throw new Error(
    `constructAiProvider: provider id "${idStr}" is not wired. Register an adapter and extend the factory.`,
  );
}

/**
 * Step 31d: build the loop driver the agentic loop calls. The Bedrock branch
 * wires the live SDK transport OR — when `VEYRA_BEDROCK_RECORDING=<path>` is
 * set — the recorded-fixture transport. Anthropic + OpenAI loop-driver
 * branches are out of scope this step (they remain legacy `AiProvider`
 * adapters; their loop-driver wiring lands when actually needed).
 */
export async function constructLoopDriver(
  deps: AiProviderFactoryDeps,
): Promise<{ readonly id: ProviderId; readonly driver: AiDriver }> {
  const idStr = String(deps.providerId);
  if (idStr === 'bedrock') {
    const region =
      deps.envReader('AWS_REGION') ?? deps.envReader('AWS_DEFAULT_REGION');
    if (region === undefined || region.length === 0) {
      throw new Error(
        'constructLoopDriver(bedrock): AWS_REGION (or AWS_DEFAULT_REGION) must be set in the environment.',
      );
    }
    const recordingPath = deps.envReader('VEYRA_BEDROCK_RECORDING');
    const transport =
      recordingPath !== undefined && recordingPath.length > 0
        ? recordedBedrockTransport(loadBedrockRecording(recordingPath))
        : liveBedrockTransport({ region });
    // Step 31d codex §6.5-r2 MUST #5: substitute the cross-provider default
    // sentinel (`claude-sonnet-4-6`, mirrored from `scan-command.ts`
    // DEFAULT_AI_MODEL) with a Bedrock-shaped inference-profile id. Without
    // this substitution, `--ai-provider bedrock` without `--ai-model` would
    // send the non-Bedrock id to Bedrock, which rejects it. An explicit
    // `--ai-model <bedrock-id>` is honoured untouched.
    const requestedModel = deps.defaultModelId;
    const modelId =
      requestedModel === undefined ||
      requestedModel === CROSS_PROVIDER_DEFAULT_MODEL_SENTINEL
        ? BEDROCK_DEFAULT_MODEL
        : requestedModel;
    return createBedrockProvider({
      transport,
      modelId,
    });
  }
  throw new Error(
    `constructLoopDriver: provider id "${idStr}" is not wired as a loop driver in this build. Bedrock is the supported Phase-3 loop driver; the legacy Anthropic/OpenAI adapters keep the AiProvider shape.`,
  );
}

/** Load a recorded Bedrock response fixture. Expected JSON shape:
 *  `{"recordings":[<BedrockStructuredResponse>, …]}` OR a bare array. */
function loadBedrockRecording(filePath: string): readonly BedrockStructuredResponse[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as readonly BedrockStructuredResponse[];
  }
  if (parsed !== null && typeof parsed === 'object' && 'recordings' in parsed) {
    const recordings = (parsed as { recordings: unknown }).recordings;
    if (Array.isArray(recordings)) {
      return recordings as readonly BedrockStructuredResponse[];
    }
  }
  throw new Error(
    `bedrock recording at ${filePath} is malformed: expected an array of BedrockStructuredResponse or {recordings: [...]}.`,
  );
}
