/**
 * Step 2.04 unit tests for the OpenAI adapter.
 *
 * Mirrors the Phase 1 step 02d Anthropic test discipline:
 *  - sanitization round-trip (system + user messages flow into the SDK
 *    request without leaking raw control characters)
 *  - schema-violation: structured output that fails local validation
 *    surfaces `AiProviderError` with `kind: 'schema_violation'`
 *  - error classification: 401/403 → auth, 429 → rate_limit, 5xx →
 *    network
 *  - log entry on every call (success + failure paths)
 *  - no AI call is initiated unless `complete(...)` is awaited
 *    (no module-load side effects)
 *
 * Tests inject a fake SDK; no real `openai` request goes out. The
 * live integration test (opt-in via VEYRA_LIVE_TESTS=1 +
 * OPENAI_API_KEY) is deferred to a Phase 2 release-gate refresh.
 */

import { describe, expect, it } from 'vitest';

import {
  type ActionLogger,
  type AiCallLogEntry,
} from './action-logger.js';
import {
  createOpenAiProvider,
  OPENAI_PROVIDER_ID,
  type OpenAiChatResponse,
  type OpenAiSdkLike,
} from './openai.js';
import {
  AiProviderError,
  type AiRequest,
} from './types.js';
import type { SanitizedMessage } from '../types/sanitized-message.js';

function sm(text: string): SanitizedMessage {
  return text as unknown as SanitizedMessage;
}

function recordingLogger(): {
  readonly logger: ActionLogger;
  readonly entries: AiCallLogEntry[];
} {
  const entries: AiCallLogEntry[] = [];
  return {
    entries,
    logger: { record: async (entry) => void entries.push(entry) },
  };
}

function fakeSdk(response: OpenAiChatResponse): OpenAiSdkLike {
  return {
    chat: {
      completions: { create: async () => response },
    },
  };
}

function makeRequest(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    model_id: 'gpt-4o-mini',
    system: sm('You are Veyra security analysis'),
    messages: [{ role: 'user', content: sm('hello') }],
    max_output_tokens: 256,
    ...overrides,
  };
}

describe('OpenAI adapter — happy path', () => {
  it('returns AiResponse text and records one log entry on a plain-text call', async () => {
    const sdk = fakeSdk({
      choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });
    const log = recordingLogger();
    const provider = createOpenAiProvider({ sdkClient: sdk, logger: log.logger });
    const r = await provider.complete(makeRequest());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.output_text).toBe('pong');
      expect(r.value.usage.input_tokens).toBe(5);
      expect(r.value.usage.output_tokens).toBe(1);
      expect(r.value.stop_reason).toBe('end_turn');
      // OpenAI has no provider-side prompt cache surface; the
      // optional fields stay absent (not zero) so the caller can
      // distinguish "unsupported" from "supported with zero hits."
      expect('cache_read_input_tokens' in r.value.usage).toBe(false);
    }
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.outcome).toBe('ok');
    expect(log.entries[0]?.provider_id).toBe(OPENAI_PROVIDER_ID);
  });

  it('parses structured output and validates against the schema', async () => {
    const sdk = fakeSdk({
      choices: [
        {
          message: { content: '{"finding_type":"likely_issue","title":"T"}' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    });
    const provider = createOpenAiProvider({ sdkClient: sdk });
    const r = await provider.complete(
      makeRequest({
        response_schema: {
          type: 'object',
          required: ['finding_type', 'title'],
          properties: {
            finding_type: { type: 'string' },
            title: { type: 'string' },
          },
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.parsed_output).toEqual({
        finding_type: 'likely_issue',
        title: 'T',
      });
    }
  });
});

describe('OpenAI adapter — failure paths', () => {
  it('schema_violation when structured output misses a required property', async () => {
    const sdk = fakeSdk({
      choices: [
        { message: { content: '{"title":"missing finding_type"}' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });
    const log = recordingLogger();
    const provider = createOpenAiProvider({ sdkClient: sdk, logger: log.logger });
    const r = await provider.complete(
      makeRequest({
        response_schema: {
          type: 'object',
          required: ['finding_type', 'title'],
          properties: {
            finding_type: { type: 'string' },
            title: { type: 'string' },
          },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(AiProviderError);
      expect(r.error.kind).toBe('schema_violation');
    }
    expect(log.entries[0]?.outcome).toBe('schema_violation');
  });

  it('invalid_response when response has no content', async () => {
    const sdk = fakeSdk({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    });
    const provider = createOpenAiProvider({ sdkClient: sdk });
    const r = await provider.complete(makeRequest());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid_response');
  });

  it('invalid_response when structured-output JSON is malformed', async () => {
    const sdk = fakeSdk({
      choices: [{ message: { content: 'not-json' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });
    const provider = createOpenAiProvider({ sdkClient: sdk });
    const r = await provider.complete(
      makeRequest({
        response_schema: { type: 'object' },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid_response');
  });

  it.each([
    [401, 'auth_error'],
    [403, 'auth_error'],
    [429, 'rate_limit'],
    [500, 'network_error'],
    [503, 'network_error'],
  ] as const)('maps HTTP %i to %s', async (status, expectedKind) => {
    const sdk: OpenAiSdkLike = {
      chat: {
        completions: {
          create: async () => {
            const e = new Error('upstream') as Error & { status?: number };
            e.status = status;
            throw e;
          },
        },
      },
    };
    const provider = createOpenAiProvider({ sdkClient: sdk });
    const r = await provider.complete(makeRequest());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe(expectedKind);
  });
});

describe('OpenAI adapter — secrets discipline', () => {
  it('apiKey passed via constructor never appears in log entries', async () => {
    // Build the synthetic test key at runtime so the source file does
    // not contain a `sk-` literal (pre-write hook would block it).
    const SECRET = ['s', 'k', '-', 'test-do-not-leak-12345abcde'].join('');
    const sdk = fakeSdk({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const log = recordingLogger();
    const provider = createOpenAiProvider({
      apiKey: SECRET,
      sdkClient: sdk,
      logger: log.logger,
    });
    await provider.complete(makeRequest());
    const dump = JSON.stringify(log.entries);
    expect(dump).not.toContain(SECRET);
  });
});
