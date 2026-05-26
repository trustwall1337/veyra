/**
 * OpenAI adapter for the provider-agnostic `AiProvider` contract
 * (step 2.04).
 *
 * Sibling to `src/ai/anthropic.ts`. Per the step file:
 *
 *   "This is the only file in the repo that imports `openai`."
 *
 * Every other Veyra module talks to AI through `AiProvider` (from
 * `./types.js`). Adding a third provider (Gemini, Bedrock, etc.)
 * means writing a sibling adapter — never touching shared types.
 *
 * Structured output strategy:
 *
 *  - When `request.response_schema` is set, pass it via
 *    `response_format: { type: 'json_schema', strict: true, json_schema: {...} }`.
 *  - OpenAI's strict JSON Schema enforcement validates server-side at
 *    token-emit time, equivalent to Anthropic's `tool_choice` forcing.
 *  - Parse the JSON content, validate locally against the same schema
 *    using the lightweight `validateAgainstSchema` helper (shared
 *    discipline with the Anthropic adapter — server-side strict mode
 *    is helpful; local validation remains the source of truth).
 *
 * Cache strategy:
 *
 *  - OpenAI does not expose a Phase-1-equivalent prompt cache surface.
 *  - `usage.cache_read_input_tokens` is set to `0` and we note this
 *    limitation in the adapter's docs; cost-control mitigation is on
 *    the caller side (smaller system prompts).
 *
 * Audit:
 *
 *  - Every `complete` call records one `AiCallLogEntry` via the
 *    injected `ActionLogger`. The fingerprint is SHA-256 of the
 *    request envelope (model_id, system byte-length, message
 *    byte-lengths, schema bytes). Raw content never reaches the log.
 *  - API key is read from `apiKey` parameter or `OPENAI_API_KEY`
 *    env var at construction time. The key never appears in any log
 *    entry, error message, or response.
 */

import { createHash } from 'node:crypto';

import OpenAI from 'openai';

import { asProviderId, type ProviderId } from '../types/identity.js';
import { type Result, err, ok } from '../types/result.js';

import {
  type ActionLogger,
  type AiCallLogEntry,
  type AiCallOutcome,
  noopActionLogger,
} from './action-logger.js';
import {
  AiProviderError,
  type AiProvider,
  type AiProviderErrorKind,
  type AiRequest,
  type AiResponse,
  type AiStopReason,
  type AiUsage,
} from './types.js';

const DEFAULT_MODEL_ID = 'gpt-4o-mini';
const STRUCTURED_OUTPUT_SCHEMA_NAME = 'structured_output';

function brandedProviderId(value: string): ProviderId {
  const r = asProviderId(value);
  if (!r.ok) {
    throw new Error(
      `openai adapter: invalid hardcoded provider id "${value}": ${r.error.message}`,
    );
  }
  return r.value;
}

const OPENAI_PROVIDER_ID: ProviderId = brandedProviderId('openai');

/**
 * Minimal subset of the OpenAI SDK's `chat.completions.create` surface
 * that the adapter relies on. Tests inject a fake matching this shape.
 */
export interface OpenAiSdkLike {
  readonly chat: {
    readonly completions: {
      create(params: Record<string, unknown>): Promise<OpenAiChatResponse>;
    };
  };
}

export interface OpenAiChatResponse {
  readonly choices: readonly {
    readonly message: { readonly content: string | null };
    readonly finish_reason: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

export interface CreateOpenAiProviderOptions {
  readonly apiKey?: string;
  readonly defaultModelId?: string;
  readonly sdkClient?: OpenAiSdkLike;
  readonly logger?: ActionLogger;
}

function mapStopReason(raw: string | null): AiStopReason {
  switch (raw) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    default:
      return 'unknown';
  }
}

function mapUsage(raw: OpenAiChatResponse['usage']): AiUsage {
  // OpenAI does not expose a Phase-1-equivalent prompt cache; omit
  // `cache_read_input_tokens` / `cache_creation_input_tokens` so the
  // missing-fields contract is honored (caller does not see a
  // misleading 0 hit rate).
  return {
    input_tokens: raw?.prompt_tokens ?? 0,
    output_tokens: raw?.completion_tokens ?? 0,
  };
}

function outcomeForKind(kind: AiProviderErrorKind): AiCallOutcome {
  return kind;
}

function fingerprintRequest(request: AiRequest): string {
  const envelope = {
    model_id: request.model_id,
    max_output_tokens: request.max_output_tokens,
    system_bytes:
      request.system === undefined ? 0 : (request.system as string).length,
    messages: request.messages.map((m) => ({
      role: m.role,
      bytes: (m.content as string).length,
    })),
    schema_bytes:
      request.response_schema === undefined
        ? 0
        : JSON.stringify(request.response_schema).length,
  };
  return createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
}

interface ValidationFailure {
  readonly path: string;
  readonly message: string;
}

/**
 * Shared narrow JSON-schema validator (same shape as
 * src/ai/anthropic.ts). Recurses object + array; checks leaf types.
 * Step 08d's ajv upgrade will replace both adapters' validators at
 * once. Until then this stays in lockstep with the Anthropic version
 * so identical inputs validate identically across providers.
 */
function validateAgainstSchema(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  pathPrefix = '',
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const schemaType = schema.type;
  if (schemaType === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      failures.push({
        path: pathPrefix || '$',
        message: `expected object, got ${typeof value}`,
      });
      return failures;
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? (schema.required as readonly unknown[])
      : [];
    for (const reqName of required) {
      if (typeof reqName === 'string' && !(reqName in obj)) {
        failures.push({
          path: `${pathPrefix}/${reqName}`,
          message: 'required property missing',
        });
      }
    }
    const properties =
      schema.properties !== undefined &&
      typeof schema.properties === 'object' &&
      schema.properties !== null
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in obj) {
        failures.push(
          ...validateAgainstSchema(obj[key], subSchema, `${pathPrefix}/${key}`),
        );
      }
    }
    return failures;
  }
  if (schemaType === 'string' && typeof value !== 'string') {
    failures.push({
      path: pathPrefix || '$',
      message: `expected string, got ${typeof value}`,
    });
  }
  if (schemaType === 'number' && typeof value !== 'number') {
    failures.push({
      path: pathPrefix || '$',
      message: `expected number, got ${typeof value}`,
    });
  }
  if (schemaType === 'boolean' && typeof value !== 'boolean') {
    failures.push({
      path: pathPrefix || '$',
      message: `expected boolean, got ${typeof value}`,
    });
  }
  if (schemaType === 'array') {
    if (!Array.isArray(value)) {
      failures.push({
        path: pathPrefix || '$',
        message: `expected array, got ${typeof value}`,
      });
      return failures;
    }
    const items = schema.items;
    if (
      items !== undefined &&
      typeof items === 'object' &&
      items !== null &&
      !Array.isArray(items)
    ) {
      const itemsSchema = items as Readonly<Record<string, unknown>>;
      for (let i = 0; i < value.length; i++) {
        failures.push(
          ...validateAgainstSchema(value[i], itemsSchema, `${pathPrefix}[${String(i)}]`),
        );
      }
    }
  }
  return failures;
}

function buildSdkRequest(
  request: AiRequest,
  defaultModelId: string,
): Record<string, unknown> {
  const modelId =
    request.model_id.length > 0 ? request.model_id : defaultModelId;
  const messages: { role: string; content: string }[] = [];
  if (request.system !== undefined) {
    messages.push({ role: 'system', content: request.system as string });
  }
  for (const m of request.messages) {
    messages.push({ role: m.role, content: m.content as string });
  }
  const sdkRequest: Record<string, unknown> = {
    model: modelId,
    max_tokens: request.max_output_tokens,
    messages,
  };
  if (request.response_schema !== undefined) {
    sdkRequest.response_format = {
      type: 'json_schema',
      json_schema: {
        name: STRUCTURED_OUTPUT_SCHEMA_NAME,
        schema: request.response_schema,
        strict: true,
      },
    };
  }
  return sdkRequest;
}

export function createOpenAiProvider(
  options: CreateOpenAiProviderOptions = {},
): AiProvider {
  const defaultModelId = options.defaultModelId ?? DEFAULT_MODEL_ID;
  const logger = options.logger ?? noopActionLogger;
  const sdkClient: OpenAiSdkLike =
    options.sdkClient ??
    (options.apiKey !== undefined
      ? (new OpenAI({ apiKey: options.apiKey }) as unknown as OpenAiSdkLike)
      : (new OpenAI() as unknown as OpenAiSdkLike));

  async function emitLog(
    entry: Omit<AiCallLogEntry, 'recorded_at'>,
  ): Promise<void> {
    const full: AiCallLogEntry = {
      ...entry,
      recorded_at: new Date().toISOString(),
    };
    try {
      await logger.record(full);
    } catch {
      // logging failures never break a scan
    }
  }

  async function complete(
    request: AiRequest,
  ): Promise<Result<AiResponse, AiProviderError>> {
    const modelId =
      request.model_id.length > 0 ? request.model_id : defaultModelId;
    const fingerprint = fingerprintRequest({ ...request, model_id: modelId });
    const startedAt = Date.now();

    let sdkResponse: OpenAiChatResponse;
    try {
      sdkResponse = await sdkClient.chat.completions.create(
        buildSdkRequest(request, defaultModelId),
      );
    } catch (e) {
      const kind = classifyThrown(e);
      const message = e instanceof Error ? e.message : String(e);
      await emitLog({
        action_id: 'ai_call',
        provider_id: OPENAI_PROVIDER_ID,
        model_id: modelId,
        prompt_fingerprint_sha256: fingerprint,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: Date.now() - startedAt,
        outcome: outcomeForKind(kind),
      });
      return err(
        new AiProviderError(message, kind, {
          provider_id: OPENAI_PROVIDER_ID,
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }

    const usage = mapUsage(sdkResponse.usage);
    const choice = sdkResponse.choices[0];
    if (choice === undefined || choice.message.content === null) {
      await emitLog({
        action_id: 'ai_call',
        provider_id: OPENAI_PROVIDER_ID,
        model_id: modelId,
        prompt_fingerprint_sha256: fingerprint,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        duration_ms: Date.now() - startedAt,
        outcome: 'invalid_response',
      });
      return err(
        new AiProviderError(
          'OpenAI response had no message content',
          'invalid_response',
          { provider_id: OPENAI_PROVIDER_ID },
        ),
      );
    }
    const outputText = choice.message.content;
    const stopReason = mapStopReason(choice.finish_reason);

    let parsedOutput: unknown;
    if (request.response_schema !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch (e) {
        await emitLog({
          action_id: 'ai_call',
          provider_id: OPENAI_PROVIDER_ID,
          model_id: modelId,
          prompt_fingerprint_sha256: fingerprint,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          duration_ms: Date.now() - startedAt,
          outcome: 'invalid_response',
        });
        const m = e instanceof Error ? e.message : String(e);
        return err(
          new AiProviderError(
            `OpenAI structured output was not parseable JSON: ${m}`,
            'invalid_response',
            { provider_id: OPENAI_PROVIDER_ID },
          ),
        );
      }
      const failures = validateAgainstSchema(parsed, request.response_schema);
      if (failures.length > 0) {
        await emitLog({
          action_id: 'ai_call',
          provider_id: OPENAI_PROVIDER_ID,
          model_id: modelId,
          prompt_fingerprint_sha256: fingerprint,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          duration_ms: Date.now() - startedAt,
          outcome: 'schema_violation',
        });
        const summary = failures
          .slice(0, 3)
          .map((f) => `${f.path}: ${f.message}`)
          .join('; ');
        return err(
          new AiProviderError(
            `structured output failed local schema validation: ${summary}`,
            'schema_violation',
            { provider_id: OPENAI_PROVIDER_ID },
          ),
        );
      }
      parsedOutput = parsed;
    }

    await emitLog({
      action_id: 'ai_call',
      provider_id: OPENAI_PROVIDER_ID,
      model_id: modelId,
      prompt_fingerprint_sha256: fingerprint,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      duration_ms: Date.now() - startedAt,
      outcome: 'ok',
    });

    const response: AiResponse = {
      model_id: modelId,
      output_text: outputText,
      ...(parsedOutput !== undefined ? { parsed_output: parsedOutput } : {}),
      stop_reason: stopReason,
      usage,
    };
    return ok(response);
  }

  return {
    id: OPENAI_PROVIDER_ID,
    complete,
  };
}

function classifyThrown(e: unknown): AiProviderErrorKind {
  if (e === null || typeof e !== 'object') return 'invalid_response';
  const errObj = e as { status?: unknown; name?: unknown };
  if (typeof errObj.status === 'number') {
    if (errObj.status === 401 || errObj.status === 403) return 'auth_error';
    if (errObj.status === 429) return 'rate_limit';
    if (errObj.status >= 500) return 'network_error';
  }
  if (typeof errObj.name === 'string') {
    if (errObj.name === 'AuthenticationError') return 'auth_error';
    if (errObj.name === 'RateLimitError') return 'rate_limit';
    if (errObj.name === 'APIConnectionError') return 'network_error';
  }
  return 'invalid_response';
}

export { OPENAI_PROVIDER_ID };
