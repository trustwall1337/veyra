/**
 * Supabase MCP client (thin policy gate over an injectable transport).
 *
 * Per PHASE_1_PLAN §7 Task 8: read-only policy enforced before every
 * tool call (not at startup only — that would be a launch-blocker for
 * Veyra itself). `read_only` is derived from the active
 * ValidationPolicy; the connector does NOT hardcode it.
 *
 * Retro-16 hardening:
 *  - f2: caller-supplied `extra` cannot override enforced `project_ref`
 *    or `read_only` fields. The enforced object is spread last.
 *  - f8: storage-bucket artifact writes pass through redactSecrets.
 *  - f9: transport exceptions are caught and converted to
 *    `SupabaseTransportError` so the Result-returning contract isn't
 *    broken by an upstream throw.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { redactSecrets } from '../../ai/sanitization.js';
import type { PolicyViolationError } from '../../types/errors.js';
import { type Result, ok, err } from '../../types/result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

import {
  SUPABASE_CONNECTOR_ID,
  checkInvocation,
} from './policy.js';

export interface SupabaseTransport {
  invokeTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  /**
   * Step 25 retro-f2: optional lifecycle hook. Production transports
   * that hold child-process / network handles (e.g. the SDK-backed
   * stdio transport spawning `npx @supabase/mcp-server-supabase`)
   * release them here. `runScan` calls `close()` from a `finally`
   * block so the subprocess + SDK client are torn down even when
   * the scan errors out. Test transports may omit this — the field
   * is optional and callers must null-check before invoking.
   */
  close?(): Promise<void>;
}

export interface SupabaseClientOptions {
  readonly transport: SupabaseTransport;
  readonly projectRef: string;
  readonly policy: ValidationPolicy;
}

export class SupabaseTransportError extends Error {
  override readonly name = 'SupabaseTransportError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type SupabaseClientError = PolicyViolationError | SupabaseTransportError;

const RESERVED_KEYS = new Set(['project_ref', 'read_only']);

function redactResponse(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactResponse);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactResponse(v);
    }
    return out;
  }
  return value;
}

export class SupabaseClient {
  readonly #transport: SupabaseTransport;
  readonly #projectRef: string;
  readonly #policy: ValidationPolicy;

  constructor(options: SupabaseClientOptions) {
    this.#transport = options.transport;
    this.#projectRef = options.projectRef;
    this.#policy = options.policy;
  }

  get connectorId() {
    return SUPABASE_CONNECTOR_ID;
  }

  get projectRef(): string {
    return this.#projectRef;
  }

  async invoke(
    tool: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<Result<unknown, SupabaseClientError>> {
    // Retro-16 f2: refuse to invoke if caller passed reserved keys.
    for (const k of Object.keys(extra)) {
      if (RESERVED_KEYS.has(k)) {
        // Reserved keys (project_ref, read_only) cannot be supplied by
        // the caller — they come from policy + connector config.
        const { PolicyViolationError } = await import('../../types/errors.js');
        return err(
          new PolicyViolationError(
            `Supabase invocation rejected: caller cannot set reserved key "${k}" via extra`,
            'read_schema_metadata',
            SUPABASE_CONNECTOR_ID as string,
          ),
        );
      }
    }
    const checked = checkInvocation(tool, this.#projectRef, this.#policy);
    if (!checked.ok) return checked;
    let raw: unknown;
    try {
      // Spread `extra` FIRST so enforced fields cannot be overridden.
      raw = await this.#transport.invokeTool(tool, {
        ...extra,
        project_ref: checked.value.project_ref,
        read_only: checked.value.read_only,
      });
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : String(cause);
      return err(
        new SupabaseTransportError(
          `Supabase transport failed for "${tool}": ${m}`,
          cause,
        ),
      );
    }
    return ok(redactResponse(raw));
  }

  listTables(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('list_tables');
  }

  listExtensions(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('list_extensions');
  }

  listMigrations(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('list_migrations');
  }

  getAdvisors(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('get_advisors');
  }

  getLogs(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('get_logs');
  }

  listEdgeFunctions(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('list_edge_functions');
  }

  getEdgeFunction(slug: string): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('get_edge_function', { slug });
  }

  listStorageBuckets(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('list_storage_buckets');
  }

  getStorageConfig(): Promise<Result<unknown, SupabaseClientError>> {
    return this.invoke('get_storage_config');
  }

  /**
   * Persist the `list_storage_buckets` response as
   * `storage-buckets.json` for step 09's bucket-detection path.
   * Retro-16 f8: pass through redactSecrets before writing.
   */
  async writeStorageBucketsArtifact(
    artifactDir: string,
    buckets: unknown,
  ): Promise<Result<string, Error>> {
    const out = path.join(artifactDir, 'storage-buckets.json');
    try {
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(
        out,
        JSON.stringify({ buckets: redactResponse(buckets) }, null, 2),
        'utf8',
      );
      return ok(out);
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : String(cause);
      return err(new Error(`failed to write ${out}: ${m}`));
    }
  }
}

export function createSupabaseClient(
  options: SupabaseClientOptions,
): SupabaseClient {
  return new SupabaseClient(options);
}
