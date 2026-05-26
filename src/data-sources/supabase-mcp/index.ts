/**
 * Supabase MCP backend registration (step 27 alternative backend).
 *
 * Marked `devOnly: true` — the customer-facing default is the REST
 * backend; MCP only activates behind `VEYRA_DEV=1 +
 * --dev-supabase-backend supabase-mcp`. The customer-facing legacy flag
 * `--supabase-mcp` is rejected at parse time with a migration message
 * (see scan-command).
 */

import { asDataSourceId, type DataSourceId } from '../../types/data-sources.js';
import { registerDataSource } from '../registry.js';

import { createSupabaseMcpDatabase } from './database.js';
import { createSupabaseMcpStorage } from './storage.js';

const SUPABASE_MCP_ID: DataSourceId = (() => {
  const r = asDataSourceId('supabase-mcp');
  if (!r.ok) throw r.error;
  return r.value;
})();

export const supabaseMcpId: DataSourceId = SUPABASE_MCP_ID;

export { createSupabaseMcpDatabase, createSupabaseMcpStorage };

/**
 * Note: the MCP backend's factory cannot construct itself from
 * `DataSourceFactoryInputs` alone — it needs the existing connector's
 * `SupabaseClient` (which carries the connector's policy gate). The
 * factory below throws; the CLI bootstrap path builds the MCP-backed
 * `DatabaseMetadataSource` / `StorageMetadataSource` directly via the
 * exported `createSupabaseMcpDatabase` / `createSupabaseMcpStorage`.
 *
 * The registry entry is still useful for listing / docs / dev-only
 * gating, even if the factories throw.
 */
export function registerSupabaseMcp(): void {
  registerDataSource({
    id: SUPABASE_MCP_ID,
    label: 'Supabase MCP (alternative backend)',
    devOnly: true,
    database: () => {
      throw new Error(
        'supabase-mcp DatabaseMetadataSource must be constructed via createSupabaseMcpDatabase(client) — see scan-command bootstrap',
      );
    },
    storage: () => {
      throw new Error(
        'supabase-mcp StorageMetadataSource must be constructed via createSupabaseMcpStorage(client) — see scan-command bootstrap',
      );
    },
  });
}
