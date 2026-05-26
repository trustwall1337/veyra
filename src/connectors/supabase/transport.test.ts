/**
 * Unit tests for the production Supabase MCP transport (step 25).
 *
 * The tests use the `clientFactory` test seam to inject a fake SDK
 * Client. No subprocess is spawned, no network call is made, and the
 * SDK itself is not imported at test time. The test asserts the
 * shape of calls between the transport and the Client, the token
 * redaction discipline, and the close() lifecycle hook.
 */

import { describe, expect, it } from 'vitest';

import {
  SupabaseTransportConfigurationError,
  buildStdioTransportOptions,
  createDefaultSupabaseTransport,
  type SupabaseMcpClient,
} from './transport.js';

interface RecordedCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>> | undefined;
}

interface FakeClientHandle {
  readonly client: SupabaseMcpClient;
  readonly calls: RecordedCall[];
  closeCount: () => number;
}

function makeFakeClient(
  responder: (name: string) => unknown = (name) => ({ name, ok: true }),
): FakeClientHandle {
  const calls: RecordedCall[] = [];
  let closes = 0;
  const client: SupabaseMcpClient = {
    async callTool(params) {
      calls.push({ name: params.name, args: params.arguments });
      const payload = responder(params.name);
      // Mirror the MCP SDK shape: tool results come back as
      // { content: [{ type: 'text', text: <json> }], structuredContent? }.
      return {
        content: [
          { type: 'text', text: JSON.stringify(payload) },
        ],
      };
    },
    async close() {
      closes += 1;
    },
  };
  return { client, calls, closeCount: () => closes };
}

describe('createDefaultSupabaseTransport — input validation', () => {
  it('rejects empty project_ref', () => {
    expect(() =>
      createDefaultSupabaseTransport({
        projectRef: '',
        accessToken: 'tok',
      }),
    ).toThrow(SupabaseTransportConfigurationError);
  });

  it('rejects empty access token', () => {
    expect(() =>
      createDefaultSupabaseTransport({
        projectRef: 'ref-1',
        accessToken: '',
      }),
    ).toThrow(SupabaseTransportConfigurationError);
  });
});

describe('createDefaultSupabaseTransport — invokeTool plumbing', () => {
  it('forwards name + arguments to the SDK Client callTool', async () => {
    const fake = makeFakeClient(() => ({
      tables: [{ schema: 'public', name: 'orders', rls_enabled: true }],
    }));
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 's3cret-token-test-value',
      clientFactory: async () => fake.client,
    });
    const result = await transport.invokeTool('list_tables', {
      project_ref: 'ref-1',
      read_only: true,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.name).toBe('list_tables');
    expect(fake.calls[0]?.args).toEqual({
      project_ref: 'ref-1',
      read_only: true,
    });
    // Unwraps the SDK content envelope into the bare JSON payload.
    expect(result).toEqual({
      tables: [{ schema: 'public', name: 'orders', rls_enabled: true }],
    });
  });

  it('opens the SDK Client lazily — no subprocess until first invokeTool', async () => {
    let factoryCalls = 0;
    const fake = makeFakeClient();
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => {
        factoryCalls += 1;
        return fake.client;
      },
    });
    expect(factoryCalls).toBe(0);
    await transport.invokeTool('list_tables', {});
    await transport.invokeTool('get_advisors', {});
    expect(factoryCalls).toBe(1); // single client reused across calls
  });

  it('redacts the access token from error messages (CLAUDE.md §Secrets)', async () => {
    const token = 'this-is-a-fake-token-do-not-store-anywhere-abc123';
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: token,
      clientFactory: async () => ({
        async callTool() {
          // The SDK could echo the token in an error string if the
          // server's response leaks it. Simulate that worst case here.
          throw new Error(`upstream error referencing token ${token}`);
        },
        async close() {
          // no-op
        },
      }),
    });
    let caught: Error | undefined;
    try {
      await transport.invokeTool('list_tables', { project_ref: 'ref-1', read_only: true });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).not.toContain(token);
    expect(caught?.message).toContain('REDACTED');
  });

  it('throws when the tool result has isError=true', async () => {
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => ({
        async callTool() {
          return {
            content: [{ type: 'text', text: 'tool failed' }],
            isError: true,
          };
        },
        async close() {
          // no-op
        },
      }),
    });
    await expect(
      transport.invokeTool('list_tables', {}),
    ).rejects.toThrow(/Supabase MCP/);
  });
});

describe('buildStdioTransportOptions — access token never reaches argv (codex retro-f2 / step25-f2)', () => {
  const fakeToken = 'fake-access-token-must-not-appear-in-argv-9f8b2c';
  const fakeProjectRef = 'test-project-ref-abc';

  it('command + args do NOT contain the access token', () => {
    const opts = buildStdioTransportOptions({
      projectRef: fakeProjectRef,
      accessToken: fakeToken,
    });
    const joined = `${opts.command} ${opts.args.join(' ')}`;
    expect(joined).not.toContain(fakeToken);
    // The fake project_ref is a public identifier and IS allowed in argv.
    expect(opts.args).toContain(fakeProjectRef);
  });

  it('env.SUPABASE_ACCESS_TOKEN carries the token (this is the only allowed channel)', () => {
    const opts = buildStdioTransportOptions({
      projectRef: fakeProjectRef,
      accessToken: fakeToken,
    });
    expect(opts.env.SUPABASE_ACCESS_TOKEN).toBe(fakeToken);
  });

  it('args carry --project-ref + --read-only flags', () => {
    const opts = buildStdioTransportOptions({
      projectRef: fakeProjectRef,
      accessToken: fakeToken,
    });
    expect(opts.args).toContain('--project-ref');
    expect(opts.args).toContain('--read-only');
    // --project-ref is immediately followed by its value.
    const idx = opts.args.indexOf('--project-ref');
    expect(opts.args[idx + 1]).toBe(fakeProjectRef);
  });

  it('command is `npx` (so a future contributor renaming the package name on argv stays the same shape)', () => {
    const opts = buildStdioTransportOptions({
      projectRef: fakeProjectRef,
      accessToken: fakeToken,
    });
    expect(opts.command).toBe('npx');
  });
});

describe('createDefaultSupabaseTransport — close() lifecycle (codex retro-f2)', () => {
  it('close() invokes the SDK Client close exactly once', async () => {
    const fake = makeFakeClient();
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => fake.client,
    });
    await transport.invokeTool('list_tables', {});
    expect(fake.closeCount()).toBe(0);
    await transport.close?.();
    expect(fake.closeCount()).toBe(1);
  });

  it('close() is a no-op when invokeTool was never called (lazy client never opened)', async () => {
    const fake = makeFakeClient();
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => fake.client,
    });
    await transport.close?.();
    expect(fake.closeCount()).toBe(0);
  });

  it('a second close() after the first is a no-op', async () => {
    const fake = makeFakeClient();
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => fake.client,
    });
    await transport.invokeTool('list_tables', {});
    await transport.close?.();
    await transport.close?.();
    expect(fake.closeCount()).toBe(1);
  });

  it('close() redacts the access token from close-path errors (codex step25-f1)', async () => {
    const token = 'fake-close-path-leak-token-zzz999';
    // The fake client's close throws an error that includes the token —
    // simulates the worst case where SDK / subprocess shutdown echoes
    // env state into a stack trace.
    const failingClient: SupabaseMcpClient = {
      async callTool() {
        return { content: [{ type: 'text', text: '{}' }] };
      },
      async close() {
        throw new Error(`shutdown saw token ${token} in transit`);
      },
    };
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: token,
      clientFactory: async () => failingClient,
    });
    await transport.invokeTool('list_tables', {});
    let caught: Error | undefined;
    try {
      await transport.close?.();
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).not.toContain(token);
    expect(caught?.message).toContain('REDACTED');
  });
});

describe('createDefaultSupabaseTransport — content unwrapping', () => {
  it('prefers structuredContent when present', async () => {
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => ({
        async callTool() {
          return {
            content: [{ type: 'text', text: '<raw text not parseable>' }],
            structuredContent: { tables: ['x'] },
          };
        },
        async close() {
          // no-op
        },
      }),
    });
    const r = await transport.invokeTool('list_tables', {});
    expect(r).toEqual({ tables: ['x'] });
  });

  it('returns raw text when content is non-JSON', async () => {
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => ({
        async callTool() {
          return {
            content: [{ type: 'text', text: 'just a plain message' }],
          };
        },
        async close() {
          // no-op
        },
      }),
    });
    const r = await transport.invokeTool('list_tables', {});
    expect(r).toBe('just a plain message');
  });

  it('returns undefined when content is empty', async () => {
    const transport = createDefaultSupabaseTransport({
      projectRef: 'ref-1',
      accessToken: 'tok',
      clientFactory: async () => ({
        async callTool() {
          return { content: [] };
        },
        async close() {
          // no-op
        },
      }),
    });
    const r = await transport.invokeTool('list_tables', {});
    expect(r).toBeUndefined();
  });
});
