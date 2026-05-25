/**
 * Supabase MCP client (thin policy gate over an injectable transport).
 *
 * Per PHASE_1_PLAN §7 Task 8: read-only policy enforced before every
 * tool call (not at startup only — that would be a launch-blocker for
 * Veyra itself). `read_only` is derived from the active
 * ValidationPolicy; the connector does NOT hardcode it.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { PolicyViolationError } from '../../types/errors.js';
import { type Result, ok, err } from '../../types/result.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

import {
  SUPABASE_CONNECTOR_ID,
  checkInvocation,
} from './policy.js';

export interface SupabaseTransport {
  invokeTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface SupabaseClientOptions {
  readonly transport: SupabaseTransport;
  readonly projectRef: string;
  readonly policy: ValidationPolicy;
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
  ): Promise<Result<unknown, PolicyViolationError>> {
    const checked = checkInvocation(tool, this.#projectRef, this.#policy);
    if (!checked.ok) return checked;
    return ok(
      await this.#transport.invokeTool(tool, {
        project_ref: checked.value.project_ref,
        read_only: checked.value.read_only,
        ...extra,
      }),
    );
  }

  listTables(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('list_tables');
  }

  getAdvisors(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('get_advisors');
  }

  listStorageBuckets(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('list_storage_buckets');
  }

  getStorageConfig(): Promise<Result<unknown, PolicyViolationError>> {
    return this.invoke('get_storage_config');
  }

  /**
   * Persist the `list_storage_buckets` response as
   * `storage-buckets.json` for step 09's bucket-detection path.
   */
  async writeStorageBucketsArtifact(
    artifactDir: string,
    buckets: unknown,
  ): Promise<Result<string, Error>> {
    const out = path.join(artifactDir, 'storage-buckets.json');
    try {
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(out, JSON.stringify({ buckets }, null, 2), 'utf8');
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
