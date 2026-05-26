/**
 * Supabase REST `DatabaseMetadataSource` (step 27).
 *
 * Reads tables + RLS state from `GET /v1/projects/{ref}/database/openapi`.
 * Per step 27 §"Verified Supabase Management REST endpoints": the
 * OpenAPI document is the documented surface; the parser below extracts
 * table identifiers from `paths` and `definitions` / `components.schemas`.
 *
 * Honest limitation (step 27 §"Verified ... endpoints"): the OpenAPI
 * document does NOT carry RLS policy USING / WITH CHECK expressions.
 * `fetchPolicies()` always returns a `capability_not_exposed` DataSourceError
 * so the supabase-rls agent emits a `coverage_gap` finding rather than
 * silently missing policy-level checks. Policy-expression analysis
 * remains available only via the dev-only MCP backend.
 */

import {
  DataSourceError,
  type DatabaseMetadataSource,
  type DataSourceId,
  type PolicySnapshot,
  type TableSnapshot,
} from '../../types/data-sources.js';
import { err, ok, type Result } from '../../types/result.js';

import type { SupabaseRestClient } from './client.js';

export function createSupabaseRestDatabase(
  id: DataSourceId,
  client: SupabaseRestClient,
): DatabaseMetadataSource {
  return {
    id,
    async fetchTables(): Promise<
      Result<readonly TableSnapshot[], DataSourceError>
    > {
      const r = await client.getDatabaseOpenApi();
      if (!r.ok) return r;
      const parsed = parseTablesFromOpenApi(r.value);
      if (!parsed.ok) return parsed;
      return ok(parsed.value);
    },
    async fetchPolicies(): Promise<
      Result<readonly PolicySnapshot[], DataSourceError>
    > {
      // The OpenAPI document does not expose RLS policy expressions.
      // Per step 27: this is an honest coverage_gap, not a silent miss.
      return err(
        new DataSourceError(
          'capability_not_exposed',
          'Supabase REST does not expose RLS policy expressions via documented endpoints; policy-level findings are not produced by this scan and need human review',
        ),
      );
    },
  };
}

/**
 * Extract table snapshots from a Supabase REST `database/openapi`
 * document. The document is an OpenAPI 2.0 / Swagger spec produced by
 * PostgREST; tables surface as path entries under `/{schema}/{table}`
 * and as definition entries under `definitions[<schema>.<table>]`.
 *
 * The parser is intentionally narrow:
 *  - It accepts the documented shape and falls through to
 *    `parse_error` on anything else.
 *  - It does NOT attempt to infer RLS-enabled state from the doc
 *    (the doc doesn't carry it). The `rls_enabled` field on the
 *    returned snapshot is `false` by default; downstream predicates
 *    (cc-11-5) that need RLS state from REST should fall through to
 *    MCP or treat as `coverage_gap`.
 */
export function parseTablesFromOpenApi(
  body: unknown,
): Result<readonly TableSnapshot[], DataSourceError> {
  if (typeof body !== 'object' || body === null) {
    return err(
      new DataSourceError(
        'parse_error',
        'Supabase REST openapi response was not a JSON object',
      ),
    );
  }
  const root = body as Record<string, unknown>;
  const definitions =
    (root['definitions'] as Record<string, unknown> | undefined) ?? undefined;
  const components =
    (root['components'] as Record<string, unknown> | undefined) ?? undefined;
  const schemas =
    (components?.['schemas'] as Record<string, unknown> | undefined) ??
    undefined;
  const candidates = definitions ?? schemas;
  if (candidates === undefined) {
    return err(
      new DataSourceError(
        'parse_error',
        'Supabase REST openapi response missing both `definitions` and `components.schemas`',
      ),
    );
  }
  const tables: TableSnapshot[] = [];
  for (const key of Object.keys(candidates)) {
    // PostgREST emits keys like `public.users` (schema-qualified) or
    // plain `users` (default schema). Accept both shapes.
    const parts = key.split('.');
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      tables.push({
        schema: parts[0],
        name: parts[1],
        rls_enabled: false,
      });
    } else if (parts.length === 1 && parts[0] !== undefined) {
      tables.push({ schema: 'public', name: parts[0], rls_enabled: false });
    }
  }
  return ok(tables);
}
