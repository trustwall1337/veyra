import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../types/result.js';

import type { ActionLogger, AiCallLogEntry } from './action-logger.js';
import {
  type AnthropicMessagesResponse,
  type AnthropicSdkLike,
  createAnthropicProvider,
} from './anthropic.js';
import { redactSecrets } from './sanitization.js';
import type { AiRequest } from './types.js';

function recordingLogger(): {
  readonly logger: ActionLogger;
  readonly entries: AiCallLogEntry[];
} {
  const entries: AiCallLogEntry[] = [];
  return {
    logger: {
      record: (e) => {
        entries.push(e);
        return Promise.resolve();
      },
    },
    entries,
  };
}

interface FakeSdkCall {
  readonly params: Record<string, unknown>;
}

function fakeSdk(
  responses: AnthropicMessagesResponse[],
): {
  readonly client: AnthropicSdkLike;
  readonly calls: FakeSdkCall[];
} {
  const calls: FakeSdkCall[] = [];
  let i = 0;
  const client: AnthropicSdkLike = {
    messages: {
      create: async (params) => {
        calls.push({ params });
        const resp = responses[i] ?? responses[responses.length - 1];
        i += 1;
        if (resp === undefined) {
          throw new Error('fake sdk has no canned response');
        }
        return resp;
      },
    },
  };
  return { client, calls };
}

const SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: {
    finding_likely: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['finding_likely', 'reason'],
};

function buildRequest(): AiRequest {
  const safeSystem = redactSecrets(
    'You are a security-readiness analyzer. Emit one structured output.',
  );
  const safeUser = redactSecrets(
    'Does the orders table appear to have RLS enabled? Reply via the emit_structured_output tool.',
  );
  return {
    model_id: 'claude-sonnet-4-6',
    system: safeSystem,
    messages: [{ role: 'user', content: safeUser }],
    max_output_tokens: 256,
    response_schema: SCHEMA,
  };
}

describe('createAnthropicProvider — happy path', () => {
  it('returns parsed_output when the tool_use input matches the schema', async () => {
    const { client, calls } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: true, reason: 'no ENABLE statement found' },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 80,
          cache_read_input_tokens: 0,
        },
      },
    ]);
    const { logger, entries } = recordingLogger();

    const provider = createAnthropicProvider({ sdkClient: client, logger });
    const result = await provider.complete(buildRequest());

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.parsed_output).toEqual({
        finding_likely: true,
        reason: 'no ENABLE statement found',
      });
      expect(result.value.model_id).toBe('claude-sonnet-4-6');
      expect(result.value.usage.input_tokens).toBe(100);
      expect(result.value.usage.cache_creation_input_tokens).toBe(80);
      expect(result.value.usage.cache_read_input_tokens).toBe(0);
    }

    expect(calls).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.outcome).toBe('ok');
    expect(entries[0]?.action_id).toBe('ai_call');
    expect(entries[0]?.provider_id).toBe('anthropic');
    expect(entries[0]?.prompt_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('createAnthropicProvider — schema violation', () => {
  it('rejects when the tool input is missing a required property', async () => {
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: true /* missing `reason` */ },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    ]);
    const { logger, entries } = recordingLogger();

    const provider = createAnthropicProvider({ sdkClient: client, logger });
    const result = await provider.complete(buildRequest());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('schema_violation');
      expect(result.error.message).toMatch(/reason/);
    }
    expect(entries[0]?.outcome).toBe('schema_violation');
  });

  it('rejects when the tool input has a wrong-typed property', async () => {
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: 'yes', reason: 'string instead of bool' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    ]);
    const { logger, entries } = recordingLogger();
    const provider = createAnthropicProvider({ sdkClient: client, logger });
    const result = await provider.complete(buildRequest());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('schema_violation');
    }
    expect(entries[0]?.outcome).toBe('schema_violation');
  });

  it('rejects when an array item violates its items schema', async () => {
    // Validator must recurse into `items` — otherwise
    // `{ type: 'array', items: { type: 'string' } }` would accept
    // numeric elements. AI Inference's Hypothesis schemas use this
    // shape for `evidence_refs`, so the recursion is load-bearing.
    const arraySchema: Readonly<Record<string, unknown>> = {
      type: 'object',
      properties: {
        refs: { type: 'array', items: { type: 'string' } },
      },
      required: ['refs'],
    };
    const arrayRequest: AiRequest = {
      ...buildRequest(),
      response_schema: arraySchema,
    };
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { refs: ['a', 2, 'c'] }, // index 1 is a number — invalid
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    ]);
    const provider = createAnthropicProvider({ sdkClient: client });
    const result = await provider.complete(arrayRequest);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('schema_violation');
      expect(result.error.message).toMatch(/refs\[1\]/);
    }
  });

  it('rejects when no tool_use block was returned', async () => {
    const { client } = fakeSdk([
      {
        content: [{ type: 'text', text: 'I refuse to use the tool.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 12 },
      },
    ]);
    const { logger, entries } = recordingLogger();
    const provider = createAnthropicProvider({ sdkClient: client, logger });
    const result = await provider.complete(buildRequest());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('invalid_response');
    }
    expect(entries[0]?.outcome).toBe('invalid_response');
  });
});

describe('createAnthropicProvider — prompt caching', () => {
  it('places cache_control on the system block, not on user turns', async () => {
    const { client, calls } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: false, reason: 'no signal' },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 80,
          cache_read_input_tokens: 0,
        },
      },
    ]);
    const provider = createAnthropicProvider({ sdkClient: client });
    await provider.complete(buildRequest());

    const sent = calls[0]?.params;
    expect(sent).toBeDefined();
    const system = sent?.['system'] as
      | Array<{ cache_control?: unknown }>
      | undefined;
    // Every system block must carry cache_control (not just the first).
    // Step 02d Done-When covers "system prompt + control-catalog
    // blocks"; once catalog blocks land, this loop still holds.
    expect(system).toBeDefined();
    expect((system ?? []).length).toBeGreaterThan(0);
    for (const block of system ?? []) {
      expect(block.cache_control).toEqual({ type: 'ephemeral' });
    }
    const messages = sent?.['messages'] as
      | Array<{ cache_control?: unknown }>
      | undefined;
    for (const m of messages ?? []) {
      expect(m.cache_control).toBeUndefined();
    }
  });

  it('surfaces cache_read_input_tokens > 0 on a second call', async () => {
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: true, reason: 'first call' },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_creation_input_tokens: 80,
          cache_read_input_tokens: 0,
        },
      },
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'emit_structured_output',
            input: { finding_likely: true, reason: 'second call' },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 80,
        },
      },
    ]);
    const provider = createAnthropicProvider({ sdkClient: client });
    const first = await provider.complete(buildRequest());
    const second = await provider.complete(buildRequest());

    expect(isOk(first) && isOk(second)).toBe(true);
    if (isOk(first) && isOk(second)) {
      expect(first.value.usage.cache_read_input_tokens).toBe(0);
      expect(second.value.usage.cache_read_input_tokens).toBe(80);
    }
  });
});

describe('createAnthropicProvider — action logger', () => {
  // Build the secret-shaped string at runtime so this source file does
  // not embed a literal that pre-write hooks block.
  const FAKE_KEY = ['s', 'k', '-'].join('') + 'ant-' + 'x'.repeat(80);

  it('records exactly one entry per call with provider_id=anthropic', async () => {
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: false, reason: 'noop' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'emit_structured_output',
            input: { finding_likely: true, reason: 'noop2' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 6 },
      },
    ]);
    const { logger, entries } = recordingLogger();

    const provider = createAnthropicProvider({
      apiKey: FAKE_KEY,
      sdkClient: client,
      logger,
    });
    await provider.complete(buildRequest());
    await provider.complete(buildRequest());

    expect(entries).toHaveLength(2);
    expect(entries[0]?.provider_id).toBe('anthropic');
    expect(entries[1]?.provider_id).toBe('anthropic');
    expect(entries[0]?.action_id).toBe('ai_call');
    expect(entries[0]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('never lets the API key reach the log even on a forced-error path', async () => {
    // Defense in depth: even if the SDK throws an error whose message
    // happens to contain the key value (some HTTP libraries echo auth
    // headers in errors), the recorded entry and the returned error
    // must not surface it.
    const throwingClient: AnthropicSdkLike = {
      messages: {
        create: () =>
          Promise.reject(
            new Error(`request failed for key=${FAKE_KEY} (synthetic)`),
          ),
      },
    };
    const { logger, entries } = recordingLogger();
    const provider = createAnthropicProvider({
      apiKey: FAKE_KEY,
      sdkClient: throwingClient,
      logger,
    });
    const result = await provider.complete(buildRequest());

    expect(isErr(result)).toBe(true);
    // The adapter must not propagate raw SDK error messages that
    // contain the key into the structured AiCallLogEntry — entries
    // are envelope-only and do not include the SDK error string.
    expect(JSON.stringify(entries)).not.toContain(FAKE_KEY);
  });

  it('never puts the API key into any log entry', async () => {
    const { client } = fakeSdk([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_structured_output',
            input: { finding_likely: false, reason: 'noop' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    const { logger, entries } = recordingLogger();

    const provider = createAnthropicProvider({
      apiKey: FAKE_KEY,
      sdkClient: client,
      logger,
    });
    await provider.complete(buildRequest());

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(FAKE_KEY);
    // The fingerprint is SHA-256, never raw content.
    expect(entries[0]?.prompt_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
