/**
 * Supabase REST `StorageMetadataSource` (step 27).
 *
 * Reads buckets from `GET /v1/projects/{ref}/storage/buckets` and
 * project storage config from `GET /v1/projects/{ref}/config/storage`.
 * Both endpoints are documented v1 surfaces (step 27 §"Verified
 * Supabase Management REST endpoints").
 */

import {
  DataSourceError,
  type BucketSnapshot,
  type DataSourceId,
  type StorageConfig,
  type StorageMetadataSource,
} from '../../types/data-sources.js';
import { err, ok, type Result } from '../../types/result.js';

import type { SupabaseRestClient } from './client.js';

export function createSupabaseRestStorage(
  id: DataSourceId,
  client: SupabaseRestClient,
): StorageMetadataSource {
  return {
    id,
    async fetchBuckets(): Promise<
      Result<readonly BucketSnapshot[], DataSourceError>
    > {
      const r = await client.listStorageBuckets();
      if (!r.ok) return r;
      return parseBuckets(r.value);
    },
    async fetchStorageConfig(): Promise<Result<StorageConfig, DataSourceError>> {
      const r = await client.getStorageConfig();
      if (!r.ok) return r;
      return parseStorageConfig(r.value);
    },
  };
}

export function parseBuckets(
  body: unknown,
): Result<readonly BucketSnapshot[], DataSourceError> {
  if (!Array.isArray(body)) {
    return err(
      new DataSourceError(
        'parse_error',
        'Supabase REST storage/buckets response was not an array',
      ),
    );
  }
  const out: BucketSnapshot[] = [];
  for (const raw of body) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? (r['id'] as string) : undefined;
    const name =
      typeof r['name'] === 'string' ? (r['name'] as string) : undefined;
    const pub = r['public'];
    if (id === undefined || name === undefined) continue;
    out.push({
      id,
      name,
      public: pub === true,
    });
  }
  return ok(out);
}

export function parseStorageConfig(
  body: unknown,
): Result<StorageConfig, DataSourceError> {
  if (typeof body !== 'object' || body === null) {
    return err(
      new DataSourceError(
        'parse_error',
        'Supabase REST config/storage response was not a JSON object',
      ),
    );
  }
  const r = body as Record<string, unknown>;
  const out: { -readonly [K in keyof StorageConfig]: StorageConfig[K] } = {};
  if (typeof r['fileSizeLimit'] === 'number') {
    out.fileSizeLimit = r['fileSizeLimit'] as number;
  } else if (typeof r['file_size_limit'] === 'number') {
    out.fileSizeLimit = r['file_size_limit'] as number;
  }
  if (typeof r['imageTransformEnabled'] === 'boolean') {
    out.imageTransformEnabled = r['imageTransformEnabled'] as boolean;
  } else if (typeof r['features'] === 'object' && r['features'] !== null) {
    const f = r['features'] as Record<string, unknown>;
    if (typeof f['image_transformation'] === 'object' && f['image_transformation'] !== null) {
      const it = f['image_transformation'] as Record<string, unknown>;
      if (typeof it['enabled'] === 'boolean') {
        out.imageTransformEnabled = it['enabled'] as boolean;
      }
    }
  }
  return ok(out);
}
