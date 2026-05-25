/**
 * Provider-agnostic AI types.
 *
 * Per AI-shape revision §7.2 and §12 (step 02c):
 *
 *   "Land the provider-agnostic AI types and the sanitization helpers
 *    that everything else depends on. No SDK imports here — the
 *    Anthropic adapter lives in 02d."
 *
 * The `AiProvider` interface is the contract every adapter implements
 * (Anthropic in step 02d; OpenAI later). The interface itself is pure
 * types — no provider SDK, no network code.
 *
 * Trust-model constraints embedded in the type:
 *
 *  - `AiMessage.content` is `SanitizedMessage`. Raw `string` cannot
 *    reach an AI prompt; the compiler refuses the assignment per the
 *    brand from step 02b.
 *  - The error union excludes "the AI is wrong about a classification"
 *    — AI is never the producer of `Finding` classifications (revision
 *    §8 #7). `AiProviderError` describes transport / schema / safety
 *    failures, not interpretation disputes.
 */

import type { ProviderId } from '../types/identity.js';
import type { Result } from '../types/result.js';
import type { SanitizedMessage } from '../types/sanitized-message.js';

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  readonly role: AiRole;
  readonly content: SanitizedMessage;
}

/**
 * Provider-agnostic completion request. The `response_schema` field is
 * a JSON-schema-shaped object; adapters that support structured output
 * (Anthropic tool use, OpenAI JSON mode) must validate the response
 * against the schema before returning a success.
 */
export interface AiRequest {
  readonly model_id: string;
  readonly system?: SanitizedMessage;
  readonly messages: readonly AiMessage[];
  readonly max_output_tokens: number;
  readonly response_schema?: Readonly<Record<string, unknown>>;
}

export type AiStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'unknown';

export interface AiUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  /**
   * Prompt-cache tokens reported by providers that support it
   * (Anthropic). Optional so other adapters can omit when not
   * supported. Added in step 02d per user direction (additive
   * extension of the 02c shape).
   */
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

export interface AiResponse {
  readonly model_id: string;
  readonly output_text: string;
  /**
   * Parsed structured output if `response_schema` was set on the
   * request and the adapter could parse the response. Adapters that
   * cannot validate the response against the schema return
   * `AiProviderError` with `kind: 'schema_violation'` instead.
   */
  readonly parsed_output?: unknown;
  readonly stop_reason: AiStopReason;
  readonly usage: AiUsage;
}

export type AiProviderErrorKind =
  | 'network_error'
  | 'rate_limit'
  | 'invalid_response'
  | 'schema_violation'
  | 'auth_error'
  | 'prompt_injection_suspected';

export class AiProviderError extends Error {
  override readonly name = 'AiProviderError';
  public readonly kind: AiProviderErrorKind;
  public readonly provider_id: ProviderId | undefined;

  constructor(
    message: string,
    kind: AiProviderErrorKind,
    options?: ErrorOptions & { provider_id?: ProviderId },
  ) {
    super(message, options);
    this.kind = kind;
    this.provider_id = options?.provider_id;
  }
}

/**
 * Provider-agnostic AI adapter contract. Implementations live in
 * `src/ai/providers/<name>/` (Anthropic in step 02d). The interface is
 * the boundary that lets the rest of Veyra stay provider-agnostic.
 *
 * `id` is an opaque `ProviderId` brand (per `FPP §2A` rule 1 + step 02c
 * user direction). The runtime value is e.g. `'anthropic'`, but no
 * shared type ever names that union — adding a new provider is a
 * registry edit, not a closed-union edit.
 */
export interface AiProvider {
  readonly id: ProviderId;
  complete(request: AiRequest): Promise<Result<AiResponse, AiProviderError>>;
}

export function assertExhaustiveAiRole(x: never): never {
  throw new Error(`Unhandled AiRole: ${JSON.stringify(x)}`);
}

export function assertExhaustiveAiStopReason(x: never): never {
  throw new Error(`Unhandled AiStopReason: ${JSON.stringify(x)}`);
}

export function assertExhaustiveAiProviderErrorKind(x: never): never {
  throw new Error(`Unhandled AiProviderErrorKind: ${JSON.stringify(x)}`);
}
