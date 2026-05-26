/**
 * Supabase MCP `StorageMetadataSource` (step 27 alternative backend).
 *
 * Wraps the existing SupabaseClient's bucket + storage-config methods.
 * The MCP policy gate (read_only=true + project_ref) is enforced
 * inside the client; this adapter does not relax it.
 */

import type { SupabaseClient } from '../../connectors/supabase/client.js';
import {
  DataSourceError,
  type BucketSnapshot,
  type DataSourceId,
  type StorageConfig,
  type StorageMetadataSource,
} from '../../types/data-sources.js';
import { err, ok, type Result } from '../../types/result.js';

export function createSupabaseMcpStorage(
  id: DataSourceId,
  client: SupabaseClient,
): StorageMetadataSource {
  return {
    id,
    async fetchBuckets(): Promise<
      Result<readonly BucketSnapshot[], DataSourceError>
    > {
      const r = await client.listStorageBuckets();
      if (!r.ok) {
        return err(
          new DataSourceError(
            'transport_error',
            `Supabase MCP list_storage_buckets failed: ${r.error.message}`,
            r.error,
          ),
        );
      }
      return ok(parseMcpBuckets(r.value));
    },
    async fetchStorageConfig(): Promise<Result<StorageConfig, DataSourceError>> {
      const r = await client.getStorageConfig();
      if (!r.ok) {
        return err(
          new DataSourceError(
            'transport_error',
            `Supabase MCP get_storage_config failed: ${r.error.message}`,
            r.error,
          ),
        );
      }
      return ok(parseMcpStorageConfig(r.value));
    },
  };
}

function parseMcpBuckets(raw: unknown): readonly BucketSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: BucketSnapshot[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? (r['id'] as string) : undefined;
    const name =
      typeof r['name'] === 'string' ? (r['name'] as string) : undefined;
    const pub = r['public'] === true;
    if (id === undefined || name === undefined) continue;
    out.push({ id, name, public: pub });
  }
  return out;
}

function parseMcpStorageConfig(raw: unknown): StorageConfig {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof StorageConfig]: StorageConfig[K] } = {};
  if (typeof r['fileSizeLimit'] === 'number') {
    out.fileSizeLimit = r['fileSizeLimit'] as number;
  } else if (typeof r['file_size_limit'] === 'number') {
    out.fileSizeLimit = r['file_size_limit'] as number;
  }
  if (typeof r['imageTransformEnabled'] === 'boolean') {
    out.imageTransformEnabled = r['imageTransformEnabled'] as boolean;
  }
  return out;
}
