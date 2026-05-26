/**
 * Default Supabase MCP transport (step 25 production implementation).
 *
 * The Veyra CLI constructs this transport when the user passes
 * `--supabase-mcp <project_ref>`. The connector's policy gate (set in
 * `policy.ts::checkInvocation`) enforces `read_only=true + project_ref`
 * on every call; this transport is the wire-level shim under that
 * gate. Per CLAUDE.md §Resolved engineering decisions:
 *
 *   "MCP client library: `@modelcontextprotocol/sdk` (official) ...
 *    If the SDK breaks at integration time, fall back to hand-rolled
 *    JSON-RPC over `fetch` — fallback is contained to
 *    `src/connectors/{lovable,supabase}/client.ts`."
 *
 * The SDK path is the chosen production transport. The implementation
 * pattern:
 *   1. Spawn the official Supabase MCP server as a local subprocess
 *      (`npx -y @supabase/mcp-server-supabase --project-ref <ref>`).
 *   2. Connect the SDK Client to that subprocess via stdio.
 *   3. Forward each `invokeTool(name, args)` to `client.callTool`.
 *   4. Unwrap the SDK's `content[]` envelope into the shape connector
 *      callers expect.
 *   5. On `close()`, tear down the SDK client + subprocess.
 *
 * The access token enters the subprocess via `env.SUPABASE_ACCESS_TOKEN`
 * only — never argv (CLAUDE.md §Secrets: "the env-var name is the
 * contract; the value never appears on argv or in any artifact").
 */

import type { SupabaseTransport } from './client.js';

export interface DefaultSupabaseTransportOptions {
  readonly projectRef: string;
  /**
   * Pre-resolved access token. The CLI reads `SUPABASE_ACCESS_TOKEN`
   * via the injected `envReader` (so tests don't mutate `process.env`)
   * and passes the value here. Per CLAUDE.md §Secrets: the token
   * never reaches argv, never lands in any artifact, never appears
   * in scan-actions.log.
   */
  readonly accessToken: string;
  /**
   * Test seam: optional SDK Client factory override. Production
   * callers leave this undefined; the default factory spawns the
   * Supabase MCP subprocess. Tests inject a fake Client (no
   * subprocess, no network) so unit tests stay deterministic and
   * offline.
   */
  readonly clientFactory?: (deps: {
    readonly projectRef: string;
    readonly accessToken: string;
  }) => Promise<SupabaseMcpClient>;
}

/**
 * Minimal Client interface the transport relies on. The shape is a
 * subset of `@modelcontextprotocol/sdk`'s Client; defining it locally
 * keeps the test seam type-checked without coupling to internal SDK
 * type exports. The two methods we use are `callTool` and `close`.
 */
export interface SupabaseMcpClient {
  callTool(params: {
    readonly name: string;
    readonly arguments?: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly content?: readonly unknown[]; readonly structuredContent?: unknown; readonly isError?: boolean }>;
  close(): Promise<void>;
}

export class SupabaseTransportConfigurationError extends Error {
  override readonly name = 'SupabaseTransportConfigurationError';
}

const SUPABASE_MCP_NPX_PACKAGE = '@supabase/mcp-server-supabase@latest';

/**
 * Pure builder for the StdioClientTransport options. Extracted from
 * the SDK-using factory so unit tests can verify the spawn shape
 * without importing `@modelcontextprotocol/sdk`. Per codex step25-f2:
 * this is the gate that proves the access token never reaches argv —
 * token only in env, never in args.
 */
export function buildStdioTransportOptions(deps: {
  readonly projectRef: string;
  readonly accessToken: string;
}): {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
} {
  return {
    command: 'npx',
    args: [
      '-y',
      SUPABASE_MCP_NPX_PACKAGE,
      '--project-ref',
      deps.projectRef,
      '--read-only',
    ],
    env: {
      ...(process.env as Record<string, string>),
      SUPABASE_ACCESS_TOKEN: deps.accessToken,
    },
  };
}

/**
 * Default SDK Client factory. Spawns the official Supabase MCP server
 * via `npx` and connects through `StdioClientTransport`. The
 * dynamic import keeps the SDK off the cold-start path of unit tests
 * (where `clientFactory` is overridden).
 */
async function defaultClientFactory(deps: {
  readonly projectRef: string;
  readonly accessToken: string;
}): Promise<SupabaseMcpClient> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/stdio.js'
  );
  // Token only in env. Argv carries the project_ref (public identifier)
  // + the read-only flag (already enforced by the connector policy
  // gate above this transport, but passing it here too signals intent
  // to the MCP server).
  const opts = buildStdioTransportOptions(deps);
  const transport = new StdioClientTransport({
    command: opts.command,
    args: [...opts.args],
    env: { ...opts.env },
  });
  const client = new Client({ name: 'veyra', version: '0.0.0' });
  await client.connect(transport);
  return {
    async callTool(params) {
      const r = await client.callTool({
        name: params.name,
        arguments: params.arguments ?? {},
      });
      return r as {
        content?: readonly unknown[];
        structuredContent?: unknown;
        isError?: boolean;
      };
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Unwrap the SDK's CallToolResult envelope. MCP tool calls return
 * `{ content: [{type: 'text', text: '<json>'}, ...], structuredContent?, isError? }`.
 * Most Supabase MCP tools serialize JSON into the text content; some
 * newer tools also populate `structuredContent` with the parsed value.
 *
 * Strategy:
 *   - If `isError` is true, throw with a sanitized message.
 *   - If `structuredContent` is present, return it directly.
 *   - Otherwise, concatenate `content[].text` and try `JSON.parse`;
 *     on parse failure return the raw concatenated text (the caller
 *     can decide how to handle).
 */
function unwrapCallToolResult(result: {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}): unknown {
  if (result.isError === true) {
    // Tool-side error. The SDK puts the human-readable error in the
    // content array. Do NOT echo argument values — they could
    // include any caller-supplied input. Just surface a generic
    // tool-failure marker; the operator can re-run with verbose
    // logging if they need more detail.
    throw new Error('Supabase MCP tool returned isError=true');
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const chunks: string[] = [];
  for (const item of result.content ?? []) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string'
    ) {
      chunks.push((item as { text: string }).text);
    }
  }
  const text = chunks.join('');
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Redact the access token from any string before it leaves the
 * transport (logs, error messages, etc.). Defense-in-depth: the
 * SDK + subprocess do not have the token in their argv-visible
 * surface, but a bug in the SDK's error formatting could echo it.
 * Per CLAUDE.md §Secrets: the value never appears in any artifact,
 * log, or error message.
 */
function redactTokenIn(s: string, token: string): string {
  if (token.length === 0) return s;
  return s.split(token).join('REDACTED');
}

/**
 * Construct the default Supabase MCP transport. Validates inputs
 * eagerly (per step 24 retro-f2) so misconfiguration surfaces at the
 * scan-command boundary rather than at agent-run time.
 */
export function createDefaultSupabaseTransport(
  options: DefaultSupabaseTransportOptions,
): SupabaseTransport {
  if (options.projectRef.length === 0) {
    throw new SupabaseTransportConfigurationError(
      '--supabase-mcp requires a non-empty project_ref',
    );
  }
  if (options.accessToken.length === 0) {
    throw new SupabaseTransportConfigurationError(
      'SUPABASE_ACCESS_TOKEN environment variable was missing or empty; --supabase-mcp cannot proceed without it',
    );
  }

  const factory = options.clientFactory ?? defaultClientFactory;
  const token = options.accessToken;

  // The SDK client is opened lazily on first invokeTool — most scans
  // call `list_tables` immediately so this is a connect-call-close
  // cycle bounded by the scan. The connection survives across the
  // 4-5 tool calls a scan makes, and `close()` tears it down.
  let clientPromise: Promise<SupabaseMcpClient> | undefined;
  function getClient(): Promise<SupabaseMcpClient> {
    if (clientPromise === undefined) {
      clientPromise = factory({
        projectRef: options.projectRef,
        accessToken: token,
      });
    }
    return clientPromise;
  }

  return {
    async invokeTool(
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
      try {
        const client = await getClient();
        const result = await client.callTool({ name, arguments: args });
        return unwrapCallToolResult(result);
      } catch (cause) {
        const raw = cause instanceof Error ? cause.message : String(cause);
        // Redact the token before surfacing the error message.
        throw new Error(
          `Supabase MCP transport "${name}" failed: ${redactTokenIn(raw, token)}`,
        );
      }
    },
    async close(): Promise<void> {
      if (clientPromise === undefined) return;
      try {
        const client = await clientPromise;
        await client.close();
      } catch (cause) {
        // Step 25 retro-f1: redact the token from any close-path
        // error before it reaches the caller's logger. The SDK or
        // subprocess shutdown could echo env-derived strings into
        // the error message; defense-in-depth keeps the token out.
        const raw = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Supabase MCP transport close failed: ${redactTokenIn(raw, token)}`,
        );
      } finally {
        clientPromise = undefined;
      }
    },
  };
}
