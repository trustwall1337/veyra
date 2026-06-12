import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ActorSecretRegistry } from '../../core/sandbox/actor-secret-registry.js';
import {
  type ToolDescriptor,
  ToolInvocationError,
} from '../../core/tools/descriptor.js';
import { asToolId } from '../../core/tools/tool-id.js';
import type { WriteRegistry } from '../../core/sandbox/http-write-registry.js';
import { compileProbeRequest } from '../../agents/sandbox-runner/probe-compiler.js';
import { PROBE_PRIMITIVE_CATALOG } from '../../agents/sandbox-runner/probe-primitives/index.js';
import { err, isErr, ok } from '../../types/result.js';
import type { ScanFact } from '../../types/scan-fact.js';
import {
  type ToolResult,
  toolResultSchema,
} from '../../types/tool-result.js';
import { scanFactsToToolResult } from '../scan-fact-tool-result.js';

/**
 * Tool id for the AI-driven HTTP probe; ledger contract via the REUSED
 * `'call_api_with_test_identity'` action.
 */
export const PROBE_HTTP_TOOL_ID = 'probe-http';

/**
 * Step 40c-v3 — AI-driven HTTP probe descriptor. The AI proposes:
 *  - `probe_id`: looks up a `ProbePrimitive` in the runtime catalog.
 *  - `actor_id`: the synthetic user whose JWT to use (read from
 *    ActorSecretRegistry).
 *  - `ai_authored_fields`: values for the primitive's aiAuthored path-params
 *    + body fields. Compiled + validated via `compileProbeRequest` BEFORE send.
 *
 * The descriptor calls `state.recordProbeAttempt()` via the closure-passed
 * callback BEFORE send so the §K ledger row `declared_probe_attempted` fires
 * (codex round-2 MF-2). It records an audit-only WriteEntry so the cleanup
 * reverse-walk sees the audit trail without trying to undo a GET. The
 * response is parsed into `ProbeResponseSource` ScanFacts the deterministic
 * floor classifies.
 *
 * Trust model:
 *  - Required action: 'call_api_with_test_identity' (REUSE).
 *  - The JWT is read from ActorSecretRegistry and attached as
 *    `Authorization: Bearer <jwt>` to the outgoing request. The JWT NEVER
 *    appears in args, args_redacted, result, or the WriteEntry's
 *    description_redacted (V18 enforces).
 *  - The response body is NOT persisted. Only structural facts
 *    (status, returned_rows: boolean, size_bytes, sha256(body)) cross the
 *    boundary into ScanFact.
 */
export const probeHttpArgsSchema = z.object({
  probe_id: z.string().min(1).max(128),
  actor_id: z.string().min(1).max(128),
  /**
   * AI-authored path-param values. Type widened to `unknown` per Step 39b
   * codex 39b-probe-args-structured-fields-broken [APPLIED]: per-primitive
   * schemas may declare arrays (cc-11-1 pathSegments) or structured objects
   * (cc-11-13c filter, cc-11-13d embed) that the compiler validates via the
   * primitive's per-field schema. Generic `Record<string, string>` would
   * arg-reject those before the per-primitive validator runs.
   */
  path_params: z.record(z.string(), z.unknown()).default({}),
  /** AI-authored body (validated against each primitive's bodySchema). */
  body: z.unknown().optional(),
});

export interface ProbeHttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ProbeHttpTransport {
  send(request: {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  }): Promise<ProbeHttpResponse>;
}

/** Production fetch-based transport (Node 22 has fetch globally). */
export function createDefaultProbeHttpTransport(): ProbeHttpTransport {
  return {
    async send(request) {
      const init: RequestInit = {
        method: request.method,
        headers: { ...request.headers },
      };
      if (request.body !== undefined) {
        init.body = request.body;
      }
      const res = await fetch(request.url, init);
      const body = await res.text();
      return { status: res.status, body };
    },
  };
}

export interface CreateProbeHttpToolDeps {
  readonly actorSecretRegistry: ActorSecretRegistry;
  readonly writeRegistry: WriteRegistry;
  readonly transport: ProbeHttpTransport;
  /** Base URL for the target API (e.g. `https://<sandbox_ref>.supabase.co`). */
  readonly baseUrl: string;
  /** Anon key passed alongside the JWT (some Supabase PostgREST setups require apikey header). */
  readonly anonKey: string;
  /** §K ledger contract — increments `probeAttemptCount()` before send. */
  readonly recordProbeAttempt: () => void;
  /** Optional injectable hash for deterministic test fixtures. */
  readonly hashBody?: (body: string) => string;
}

export function createProbeHttpTool(
  deps: CreateProbeHttpToolDeps,
): ToolDescriptor<z.infer<typeof probeHttpArgsSchema>, ToolResult> {
  const idR = asToolId(PROBE_HTTP_TOOL_ID);
  if (isErr(idR)) throw new Error(`invalid tool id: ${idR.error.message}`);

  return {
    tool_id: idR.value,
    title:
      'Run a Step 39 probe primitive against the sandbox PostgREST surface as a synthetic actor (AI-authored fields within requestSchema bounds)',
    args_schema: probeHttpArgsSchema,
    result_schema: toolResultSchema,
    required_action: 'call_api_with_test_identity',
    source_module: 'src/scanners/probe-http/tool.ts',
    // Step 39b Decision H (codex 39b-002 + 39b-003 [APPLIED]):
    // dynamic-gate hook returns the per-primitive `requiredActions`. The
    // loop's Path B parses args first, then calls this to derive the
    // effective capability set, then enforces ALL declared actions
    // against `policy.allowed_actions`. Unknown probe_id → empty array
    // → loop denies at the gate (before invoke).
    requiredActionForArgs: (args) => {
      const primitive = PROBE_PRIMITIVE_CATALOG.get(args.probe_id);
      if (primitive === undefined) return [];
      return primitive.requiredActions;
    },
    invoke: async (args) => {
      // 1. Resolve the probe primitive from the runtime catalog.
      const primitive = PROBE_PRIMITIVE_CATALOG.get(args.probe_id);
      if (primitive === undefined) {
        return err(
          new ToolInvocationError(
            `probe-http: unknown probe_id "${args.probe_id}" (catalog has: ${Array.from(PROBE_PRIMITIVE_CATALOG.keys()).join(', ')})`,
          ),
        );
      }

      // 2. Resolve the actor's JWT from the in-process registry.
      const secret = deps.actorSecretRegistry.get(args.actor_id);
      if (secret === undefined) {
        return err(
          new ToolInvocationError(
            `probe-http: unknown actor_id "${args.actor_id}"; was establish-actor-session called first?`,
          ),
        );
      }
      const jwt = secret.access_token;
      if (jwt === undefined) {
        return err(
          new ToolInvocationError(
            `probe-http: actor "${args.actor_id}" has no session; call establish-actor-session first`,
          ),
        );
      }

      // 3. Compile the AI-authored request against the primitive's requestSchema.
      const compiled = compileProbeRequest(primitive, {
        method: primitive.requestSchema.method.value,
        path_params: args.path_params,
        body: args.body,
      });
      if (!compiled.ok) {
        return err(
          new ToolInvocationError(
            `probe-http: compileProbeRequest rejected: ${compiled.reason}`,
          ),
        );
      }

      // 4. Record WriteEntry BEFORE send using the primitive's declared
      // cleanup_strategy (Step 39b codex 39b-cleanup-strategy-not-enforced
      // [APPLIED]). 39b ships every probe with `cleanup_strategy: 'audit_only'`
      // — the 5 originally-mutating probes (cc-11-4, cc-11-13b/c/d/e) are
      // observational GETs in their final 39b shape; the body-predicates
      // inspect the response. cc-11-4's POST + active-cleanup machinery is
      // deferred to a follow-up step (uncertainty_notes documents this).
      deps.writeRegistry.recordHttpWrite({
        resource_id: `probe-http:${args.probe_id}:${args.actor_id}`,
        description_redacted: `probe-http: ${compiled.method} ${compiled.url} as actor_id=${args.actor_id}`,
        cleanup_strategy: primitive.cleanup_strategy,
      });

      // 5. Call recordProbeAttempt() per codex round-2 MF-2 — ledger contract.
      deps.recordProbeAttempt();

      // 6. Send. Authorization header carries the JWT; apikey carries the
      //    anon key (Supabase PostgREST convention). Neither appears in any
      //    artifact, log, or trace.
      const fullUrl = joinBaseUrl(deps.baseUrl, compiled.url);
      let response: ProbeHttpResponse;
      try {
        response = await deps.transport.send({
          method: compiled.method,
          url: fullUrl,
          headers: {
            Authorization: `Bearer ${jwt}`,
            apikey: deps.anonKey,
            ...(compiled.body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(compiled.body !== undefined
            ? { body: JSON.stringify(compiled.body) }
            : {}),
        });
      } catch (cause) {
        return err(
          new ToolInvocationError(
            `probe-http: transport.send failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        );
      }

      // 7. Build the ProbeResponseSource ScanFact. Body is hashed; never persisted.
      const responseDigest = (deps.hashBody ?? defaultHashBody)(response.body);
      // Step 39b codex 39b-outcome-config-not-wired [APPLIED]: per-primitive
      // body predicate. cc-11-1 uses detectProtectedJsonContent (HTML shell
      // → false); cc-11-13b/c/d/e use cross-tenant / private-column checks
      // that read structural args (privateColumns, tenantColumn, embed).
      // Probes without bodyPredicate fall back to the default array-shape
      // detection (preserves cc-11-3 behavior + simple probes).
      const returnedRows =
        primitive.bodyPredicate !== undefined
          ? primitive.bodyPredicate(response.body, args.path_params)
          : detectReturnedRows(response.body);
      const fact: ScanFact = {
        fact_id: createHash('sha256')
          .update(`${args.probe_id}:${args.actor_id}:${responseDigest}`)
          .digest('hex'),
        source: {
          kind: 'probe_response',
          probe_id: args.probe_id,
          control_id: primitive.control_id,
          payload: {
            response_status: response.status,
            response_returned_rows: returnedRows,
            response_size_bytes: Buffer.byteLength(response.body, 'utf8'),
            response_digest: responseDigest,
            expectation: 'expect_denial', // primitive-level for IDOR; v3 covers cc-11-3 only
          },
        },
        observed_at: new Date().toISOString(),
        args_fingerprint_sha256: createHash('sha256')
          .update(JSON.stringify({ probe_id: args.probe_id, path_params: args.path_params }))
          .digest('hex'),
        redacted: true,
      };

      return ok(scanFactsToToolResult([fact]));
    },
  };
}

function joinBaseUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function defaultHashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Heuristic: does the response body look like it returned at least one row?
 * For PostgREST: a non-empty JSON array `[{...}]` returns rows; `[]` or
 * error-shaped `{code, message}` do not. Body is not persisted; only the
 * boolean leaves the function.
 */
function detectReturnedRows(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === '[]') return false;
  if (trimmed.startsWith('[')) {
    // Naive: any non-empty array is rows.
    return trimmed !== '[]';
  }
  // Object response — typically an error or single-row. PostgREST returns
  // arrays on GET by default; an object on GET is usually `{code, message}`
  // (auth/permission error). Treat as no rows for conservatism.
  return false;
}
