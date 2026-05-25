/**
 * Anthropic adapter for the provider-agnostic `AiProvider` contract.
 *
 * Per AI-shape revision §7.2 and step 02d:
 *
 *   "This is the only file in the repo that imports `@anthropic-ai/sdk`."
 *
 * Every other Veyra module talks to AI through `AiProvider` (from
 * `./types.js`). Adding a different provider (OpenAI, Bedrock, etc.)
 * means writing a sibling adapter — never touching shared types.
 *
 * Structured output strategy (per step 02d user direction):
 *
 *  - Define one tool, `emit_structured_output`, whose `input_schema`
 *    is the caller-provided JSON Schema from `AiRequest.response_schema`.
 *  - Force `tool_choice: { type: 'tool', name: 'emit_structured_output' }`
 *    so the model must return a `tool_use` block.
 *  - Extract the tool input; validate it locally against the same
 *    schema before returning. Anthropic-side shaping is helpful; it
 *    is not a substitute for Veyra-side validation.
 *
 * Cache strategy (per Anthropic prompt caching):
 *
 *  - `cache_control: { type: 'ephemeral' }` is placed on the system
 *    prompt block when set. Not on user turns — those change per
 *    request and caching them defeats the purpose.
 *  - Response `usage.cache_read_input_tokens` and
 *    `cache_creation_input_tokens` are mapped onto `AiUsage`
 *    extensions so callers can observe cache hit-ratio.
 *
 * Audit:
 *
 *  - Every `complete` call records one `AiCallLogEntry` via the
 *    injected `ActionLogger`. The fingerprint is SHA-256 of the
 *    request envelope (`model_id`, system byte-length, message
 *    byte-lengths, schema bytes). Raw content never reaches the log.
 *  - API key is read from `apiKey` parameter or `ANTHROPIC_API_KEY`
 *    env var at construction time. The key never appears in any log
 *    entry, error message, or response.
 */

import { createHash } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';

import type { ProviderId } from '../types/identity.js';
import { asProviderId } from '../types/identity.js';
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

const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';
const STRUCTURED_OUTPUT_TOOL_NAME = 'emit_structured_output';

function brandedProviderId(value: string): ProviderId {
  const r = asProviderId(value);
  if (!r.ok) {
    throw new Error(
      `anthropic adapter: invalid hardcoded provider id "${value}": ${r.error.message}`,
    );
  }
  return r.value;
}

const ANTHROPIC_PROVIDER_ID: ProviderId = brandedProviderId('anthropic');

/**
 * Minimal subset of the Anthropic SDK's `messages.create` surface that
 * the adapter relies on. Tests inject a fake client matching this
 * shape; the real SDK satisfies it structurally. Keeping the shape
 * narrow means SDK majors that move unrelated fields do not require
 * adapter changes.
 */
export interface AnthropicSdkLike {
  readonly messages: {
    create(
      params: Record<string, unknown>,
    ): Promise<AnthropicMessagesResponse>;
  };
}

/**
 * Subset of the Anthropic response shape the adapter reads. The real
 * SDK returns a superset; we only narrow to what's needed.
 */
export interface AnthropicMessagesResponse {
  readonly content: readonly AnthropicResponseBlock[];
  readonly stop_reason: string | null;
  readonly usage: {
    readonly input_tokens: number | null;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens?: number | null;
    readonly cache_read_input_tokens?: number | null;
  };
}

export type AnthropicResponseBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | { readonly type: string; readonly [k: string]: unknown };

export interface CreateAnthropicProviderOptions {
  /**
   * API key. When omitted, read from `process.env.ANTHROPIC_API_KEY`.
   * Never read from argv. The CLI step (03b) is responsible for
   * surfacing missing-key errors before construction.
   */
  readonly apiKey?: string;
  /** Default model id used when an `AiRequest` does not pin one. */
  readonly defaultModelId?: string;
  /**
   * Injected SDK client. Tests pass a fake to keep the suite
   * hermetic. Production callers omit this; the adapter constructs a
   * real `Anthropic(...)` instance.
   */
  readonly sdkClient?: AnthropicSdkLike;
  /** Injected logger. Tests assert on emitted entries; a later
   * orchestrator step (Phase 2 step 14, `src/core/audit/scan-actions-log.ts`)
   * wires the real append-only writer. Defaults to no-op. */
  readonly logger?: ActionLogger;
}

function mapStopReason(raw: string | null): AiStopReason {
  switch (raw) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'unknown';
  }
}

function mapUsage(
  raw: AnthropicMessagesResponse['usage'],
): AiUsage {
  const usage: AiUsage = {
    input_tokens: raw.input_tokens ?? 0,
    output_tokens: raw.output_tokens,
    ...(raw.cache_read_input_tokens != null
      ? { cache_read_input_tokens: raw.cache_read_input_tokens }
      : {}),
    ...(raw.cache_creation_input_tokens != null
      ? { cache_creation_input_tokens: raw.cache_creation_input_tokens }
      : {}),
  };
  return usage;
}

function outcomeForKind(kind: AiProviderErrorKind): AiCallOutcome {
  return kind;
}

/**
 * Stable fingerprint of the request envelope. Does NOT include raw
 * content — only model id, message roles, and content byte-lengths.
 * SHA-256 over a deterministic JSON representation.
 */
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
 * Light JSON-schema validator. Supports the subset Phase 1 actually
 * uses for structured-output schemas. This is intentionally NOT a
 * full validator — heavier validation (e.g. `ajv`) is a Phase 2
 * concern. Callers must know which keywords are honored.
 *
 * **Supported keywords:**
 *  - `type: 'object'` with `properties` + `required`
 *  - `type: 'array'` with `items` (recursed)
 *  - `type: 'string' | 'number' | 'boolean'` on leaves
 *
 * **Not enforced** (callers MUST NOT rely on these as a security
 * boundary): `enum`, `pattern`, `format`, `minimum`/`maximum`,
 * `additionalProperties`, union types like `type: ['string', 'null']`,
 * `oneOf`/`anyOf`/`allOf`. A hallucinated `control_id` like
 * `"AUTH-FAKE-999"` would pass this validator even when the schema
 * lists an `enum`; the caller's own assertion layer or step 08d's
 * `ajv` upgrade is responsible for catching that.
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
    // Recurse into each element when an `items` sub-schema is present.
    // Without this, `{ type: 'array', items: { type: 'string' } }`
    // would accept `[1, 2, 3]` — the most common Phase 1 false
    // positive once AI Inference emits Hypothesis schemas.
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
          ...validateAgainstSchema(
            value[i],
            itemsSchema,
            `${pathPrefix}[${String(i)}]`,
          ),
        );
      }
    }
  }
  return failures;
}

interface ToolUsePick {
  readonly text: string;
  readonly toolInput: unknown;
}

function pickToolUse(
  response: AnthropicMessagesResponse,
): ToolUsePick | undefined {
  let text = '';
  let toolInput: unknown;
  let toolFound = false;
  for (const block of response.content) {
    if (block.type === 'text' && typeof (block as { text: unknown }).text === 'string') {
      text += (block as { text: string }).text;
    } else if (
      block.type === 'tool_use' &&
      (block as { name: unknown }).name === STRUCTURED_OUTPUT_TOOL_NAME
    ) {
      toolInput = (block as { input: unknown }).input;
      toolFound = true;
    }
  }
  if (!toolFound) return undefined;
  return { text, toolInput };
}

function buildSdkRequest(
  request: AiRequest,
  defaultModelId: string,
): Record<string, unknown> {
  const modelId =
    request.model_id.length > 0 ? request.model_id : defaultModelId;
  const sdkRequest: Record<string, unknown> = {
    model: modelId,
    max_tokens: request.max_output_tokens,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (request.system !== undefined) {
    sdkRequest.system = [
      {
        type: 'text',
        text: request.system as string,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  if (request.response_schema !== undefined) {
    sdkRequest.tools = [
      {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description:
          'Emit the structured output that satisfies the caller-provided JSON schema. Do not call any other tool.',
        input_schema: request.response_schema,
      },
    ];
    sdkRequest.tool_choice = {
      type: 'tool',
      name: STRUCTURED_OUTPUT_TOOL_NAME,
    };
  }

  return sdkRequest;
}

/**
 * Construct an `AiProvider` backed by Anthropic. The factory accepts
 * either a real SDK client (constructed if omitted) or an injected
 * fake (tests). The returned object only exposes `id` and
 * `complete(...)` — no Anthropic-specific surface leaks out.
 */
export function createAnthropicProvider(
  options: CreateAnthropicProviderOptions = {},
): AiProvider {
  const defaultModelId = options.defaultModelId ?? DEFAULT_MODEL_ID;
  const logger = options.logger ?? noopActionLogger;

  // Construct the real client only when no fake is supplied. The real
  // constructor reads `ANTHROPIC_API_KEY` from process.env by default
  // if `apiKey` is undefined. The cast to `AnthropicSdkLike` is sound
  // because the real SDK's `messages.create` signature is a superset
  // of the narrow shape this adapter relies on (`buildSdkRequest`
  // produces a body that matches the SDK's `MessageCreateParams`
  // structurally; we just don't constrain it that tightly in the
  // injected-client shape to keep the test seam flexible).
  const sdkClient: AnthropicSdkLike =
    options.sdkClient ??
    (options.apiKey !== undefined
      ? (new Anthropic({ apiKey: options.apiKey }) as unknown as AnthropicSdkLike)
      : (new Anthropic() as unknown as AnthropicSdkLike));

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
      // Logging failures must not break a scan. The adapter's
      // primary job is the AI call.
    }
  }

  async function complete(
    request: AiRequest,
  ): Promise<Result<AiResponse, AiProviderError>> {
    const modelId =
      request.model_id.length > 0 ? request.model_id : defaultModelId;
    const fingerprint = fingerprintRequest({ ...request, model_id: modelId });
    const startedAt = Date.now();

    let sdkResponse: AnthropicMessagesResponse;
    try {
      sdkResponse = await sdkClient.messages.create(
        buildSdkRequest(request, defaultModelId),
      );
    } catch (e) {
      const kind = classifyThrown(e);
      const message = e instanceof Error ? e.message : String(e);
      await emitLog({
        action_id: 'ai_call',
        provider_id: ANTHROPIC_PROVIDER_ID,
        model_id: modelId,
        prompt_fingerprint_sha256: fingerprint,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: Date.now() - startedAt,
        outcome: outcomeForKind(kind),
      });
      return err(
        new AiProviderError(message, kind, {
          provider_id: ANTHROPIC_PROVIDER_ID,
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }

    const usage = mapUsage(sdkResponse.usage);
    const stopReason = mapStopReason(sdkResponse.stop_reason);

    let parsedOutput: unknown;
    let outputText = '';
    if (request.response_schema !== undefined) {
      const pick = pickToolUse(sdkResponse);
      if (pick === undefined) {
        await emitLog({
          action_id: 'ai_call',
          provider_id: ANTHROPIC_PROVIDER_ID,
          model_id: modelId,
          prompt_fingerprint_sha256: fingerprint,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          ...(usage.cache_read_input_tokens !== undefined
            ? { cache_read_input_tokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage.cache_creation_input_tokens !== undefined
            ? {
                cache_creation_input_tokens: usage.cache_creation_input_tokens,
              }
            : {}),
          duration_ms: Date.now() - startedAt,
          outcome: 'invalid_response',
        });
        return err(
          new AiProviderError(
            `expected tool_use block named "${STRUCTURED_OUTPUT_TOOL_NAME}", got none`,
            'invalid_response',
            { provider_id: ANTHROPIC_PROVIDER_ID },
          ),
        );
      }
      outputText = pick.text;
      const failures = validateAgainstSchema(
        pick.toolInput,
        request.response_schema,
      );
      if (failures.length > 0) {
        await emitLog({
          action_id: 'ai_call',
          provider_id: ANTHROPIC_PROVIDER_ID,
          model_id: modelId,
          prompt_fingerprint_sha256: fingerprint,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          ...(usage.cache_read_input_tokens !== undefined
            ? { cache_read_input_tokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage.cache_creation_input_tokens !== undefined
            ? {
                cache_creation_input_tokens: usage.cache_creation_input_tokens,
              }
            : {}),
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
            { provider_id: ANTHROPIC_PROVIDER_ID },
          ),
        );
      }
      parsedOutput = pick.toolInput;
    } else {
      // No schema → return whatever text the model produced. Adapters
      // for the non-structured-output path do not have a tool block.
      for (const block of sdkResponse.content) {
        if (
          block.type === 'text' &&
          typeof (block as { text: unknown }).text === 'string'
        ) {
          outputText += (block as { text: string }).text;
        }
      }
    }

    await emitLog({
      action_id: 'ai_call',
      provider_id: ANTHROPIC_PROVIDER_ID,
      model_id: modelId,
      prompt_fingerprint_sha256: fingerprint,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      ...(usage.cache_read_input_tokens !== undefined
        ? { cache_read_input_tokens: usage.cache_read_input_tokens }
        : {}),
      ...(usage.cache_creation_input_tokens !== undefined
        ? {
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
          }
        : {}),
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
    id: ANTHROPIC_PROVIDER_ID,
    complete,
  };
}

function classifyThrown(e: unknown): AiProviderErrorKind {
  // The real SDK throws typed error classes (`Anthropic.APIError`,
  // `Anthropic.AuthenticationError`, etc.). We could `instanceof`-check
  // them, but doing so locks the adapter to specific SDK majors. The
  // safer cross-version path is to inspect the conventional `status`
  // and `name` fields.
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
