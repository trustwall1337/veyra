/**
 * Unified cleanup-aware write registry (Phase 3 / Step 38, PLAN §D.3 +
 * `decisions.md` D1). The SOLE entry for state-changing HTTP writes is
 * {@link executeWriteWithRegistry}; the Path-2 Admin-SDK synthetic-resource
 * writes (created by Phase 2 synthetic-data-manager) are unified under the
 * SAME registry contract via {@link recordAdminWrite}. Post-loop cleanup
 * reverse-walks BOTH paths and produces ONE `cleanup_proof` with a single
 * `residual_count`. Failure on either path → a `cleanup_failed` Finding
 * produced by `cleanup-failed-finding.ts` (kept in a separate module so this
 * file is Finding-free; codex p3-r1-003).
 *
 * No bypass flag (D1). Direct mutating `fetch()`/`transport.send()` from a
 * leaf agent is a lint failure (structural test in
 * `http-write-registry.test.ts`).
 */

/** Internal write classification — not a provider taxonomy. */
export type WriteKind = 'http' | 'admin';

export interface WriteEntry {
  readonly id: string;
  readonly kind: WriteKind;
  /** Stable id of the resource cleanup targets (e.g. URL path, SDK id). */
  readonly resource_id: string;
  /** Redacted, audit-only description; never the raw request body. */
  readonly description_redacted: string;
  readonly recorded_at: string;
}

export interface HttpWriteRequest {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly body_redacted: string;
}

export interface HttpTransport {
  send(request: HttpWriteRequest): Promise<unknown>;
}

/** Executor used by the cleanup reverse-walk to revert a recorded write. */
export interface CleanupExecutors {
  readonly http: (entry: WriteEntry) => Promise<void>;
  readonly admin: (entry: WriteEntry) => Promise<void>;
}

export interface CleanupProof {
  readonly residual_count: number;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failures: ReadonlyArray<{
    readonly entry: WriteEntry;
    readonly error_class: string;
  }>;
}

/** Append-only registry of both write paths. */
export class WriteRegistry {
  private readonly entries: WriteEntry[] = [];
  private counter = 0;

  private nextId(kind: WriteKind): string {
    this.counter += 1;
    return `${kind}-${String(this.counter)}`;
  }

  /** Record an HTTP write BEFORE the transport is invoked (Verification a). */
  recordHttpWrite(input: {
    readonly resource_id: string;
    readonly description_redacted: string;
  }): WriteEntry {
    const entry: WriteEntry = {
      id: this.nextId('http'),
      kind: 'http',
      resource_id: input.resource_id,
      description_redacted: input.description_redacted,
      recorded_at: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Record an Admin-SDK synthetic-resource write (Path 2 unified). */
  recordAdminWrite(input: {
    readonly resource_id: string;
    readonly description_redacted: string;
  }): WriteEntry {
    const entry: WriteEntry = {
      id: this.nextId('admin'),
      kind: 'admin',
      resource_id: input.resource_id,
      description_redacted: input.description_redacted,
      recorded_at: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Read the current registry contents (audit-only; do not mutate). */
  list(): readonly WriteEntry[] {
    return this.entries;
  }

  /**
   * Cleanup reverse-walk over BOTH paths. Walks in LIFO order so dependent
   * writes are reverted before their dependencies. Returns a
   * {@link CleanupProof} carrying the residual count; an empty residual means
   * every recorded write was reverted.
   */
  async reverseWalk(executors: CleanupExecutors): Promise<CleanupProof> {
    let succeeded = 0;
    const failures: { entry: WriteEntry; error_class: string }[] = [];
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (entry === undefined) continue;
      const executor =
        entry.kind === 'http' ? executors.http : executors.admin;
      try {
        await executor(entry);
        succeeded += 1;
      } catch (cause) {
        failures.push({
          entry,
          error_class: cause instanceof Error ? cause.name : 'UnknownError',
        });
      }
    }
    return {
      residual_count: failures.length,
      attempted: this.entries.length,
      succeeded,
      failures,
    };
  }
}

/**
 * The SOLE HTTP-write entry the loop calls. Records the write FIRST (so a
 * crash mid-call still leaves cleanup state on disk), then invokes the
 * transport. Returns the transport's response unchanged.
 */
export async function executeWriteWithRegistry(input: {
  readonly registry: WriteRegistry;
  readonly transport: HttpTransport;
  readonly request: HttpWriteRequest;
  readonly resource_id: string;
  readonly description_redacted: string;
}): Promise<unknown> {
  // Record BEFORE send (Verification a).
  input.registry.recordHttpWrite({
    resource_id: input.resource_id,
    description_redacted: input.description_redacted,
  });
  return input.transport.send(input.request);
}

// Note (codex p3-r1-003 + p3-r2-001): `cleanupFailedFinding` lives in
// `cleanup-failed-finding.ts`. This module deliberately does NOT re-export it,
// so the wrapper module's transitive import graph never reaches `Finding`.
// Callers in the deterministic floor / reporter / tests import directly from
// `./cleanup-failed-finding.js`.
