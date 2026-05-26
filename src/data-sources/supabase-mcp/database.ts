/**
 * Supabase MCP `DatabaseMetadataSource` (step 27 alternative backend).
 *
 * Wraps the existing `SupabaseClient` (steps 16 + 24 + 25) behind the
 * capability-shaped `DatabaseMetadataSource` interface. Step 27 demotes
 * MCP from primary to alternative; this adapter lets agents consume
 * either backend uniformly via the registry.
 *
 * Why the MCP path stays around:
 *  - It is the only Phase 1 path that surfaces RLS policy bodies
 *    (USING / WITH CHECK expressions); REST returns
 *    `capability_not_exposed` for `fetchPolicies()`.
 *  - Existing tests + 526-test baseline depend on the connector's
 *    policy gate (read_only=true + project_ref) — we do NOT relax it.
 */

import type { SupabaseClient } from '../../connectors/supabase/client.js';
import {
  DataSourceError,
  type DatabaseMetadataSource,
  type DataSourceId,
  type PolicySnapshot,
  type TableSnapshot,
} from '../../types/data-sources.js';
import { err, ok, type Result } from '../../types/result.js';

export function createSupabaseMcpDatabase(
  id: DataSourceId,
  client: SupabaseClient,
): DatabaseMetadataSource {
  return {
    id,
    async fetchTables(): Promise<
      Result<readonly TableSnapshot[], DataSourceError>
    > {
      const r = await client.listTables();
      if (!r.ok) {
        return err(
          new DataSourceError(
            'transport_error',
            `Supabase MCP list_tables failed: ${r.error.message}`,
            r.error,
          ),
        );
      }
      return ok(parseMcpTables(r.value));
    },
    async fetchPolicies(): Promise<
      Result<readonly PolicySnapshot[], DataSourceError>
    > {
      // The Phase 1 MCP allowlist does NOT include a policy-listing tool.
      // CLAUDE.md §MCP discipline forbids `execute_sql` even under
      // read_only. So the MCP backend, in Phase 1, also cannot return
      // policy bodies from its allowlisted surface. This is the same
      // honest coverage_gap as the REST backend's fetchPolicies —
      // unblocked only by a Phase 2 allowlist decision.
      return err(
        new DataSourceError(
          'capability_not_exposed',
          'Phase 1 Supabase MCP allowlist does not expose RLS policy expressions; policy-level findings need human review',
        ),
      );
    },
  };
}

function parseMcpTables(raw: unknown): readonly TableSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: TableSnapshot[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const schema =
      typeof r['schema'] === 'string' ? (r['schema'] as string) : undefined;
    const name =
      typeof r['name'] === 'string' ? (r['name'] as string) : undefined;
    const rls =
      r['rls_enabled'] === true || r['rls_enabled'] === false
        ? (r['rls_enabled'] as boolean)
        : false;
    if (schema === undefined || name === undefined) continue;
    out.push({ schema, name, rls_enabled: rls });
  }
  return out;
}
