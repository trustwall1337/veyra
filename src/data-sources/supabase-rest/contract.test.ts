/**
 * Recorded-snapshot contract test for the Supabase REST backend (step 27).
 *
 * Snapshot mode (always runs in CI): the test injects a fake `fetch`
 * that returns the recorded JSON under `__snapshots__/`. The test
 * asserts each adapter parses the recorded shape into the capability
 * types the agents consume. Snapshot drift surfaces here.
 *
 * Live mode (opt-in): set `VEYRA_LIVE_TESTS=1`, `SUPABASE_ACCESS_TOKEN`,
 * and `SUPABASE_PROJECT_REF` in the shell, and the live `describe.skipIf`
 * block exercises the real endpoints. Live API drift surfaces there.
 *
 * The snapshot files capture the documented v1 shape circa 2026-05.
 * Refresh by replaying against the real API and copying the JSON back
 * into `__snapshots__/` — the schema-level changes will fail the
 * snapshot-mode tests first, so the refresh path is gated by an
 * explicit human decision.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import {
  SUPABASE_REST_BASE_URL,
  createSupabaseRestClient,
} from './client.js';
import {
  createSupabaseRestDatabase,
  parseTablesFromOpenApi,
} from './database.js';
import {
  createSupabaseRestStorage,
  parseBuckets,
  parseStorageConfig,
} from './storage.js';
import { asDataSourceId } from '../../types/data-sources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.join(HERE, '__snapshots__');
const FAKE_REF = 'aukqmgjnoldnhrvsolhh';
const FAKE_TOKEN = 'fake-token-only-for-snapshot-tests';

function id(s: string) {
  const r = asDataSourceId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

async function loadSnapshot(name: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path.join(SNAPSHOTS, name), 'utf8');
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Missing snapshot ${name}. Refresh by running this test with VEYRA_LIVE_TESTS=1 + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF and recording the response. Underlying: ${m}`,
    );
  }
  return JSON.parse(raw) as unknown;
}

function makeSnapshotFetch(map: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const suffix of Object.keys(map)) {
      if (url.endsWith(suffix)) {
        return new Response(JSON.stringify(map[suffix]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{"error":"unmatched in snapshot fetch"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('supabase-rest contract — snapshot mode (runs in CI)', () => {
  it('parses recorded database/openapi into TableSnapshot[]', async () => {
    const openapi = await loadSnapshot('openapi.json');
    const fetchImpl = makeSnapshotFetch({
      [`/v1/projects/${FAKE_REF}/database/openapi`]: openapi,
    });
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl,
    });
    const db = createSupabaseRestDatabase(id('supabase-rest'), client);
    const r = await db.fetchTables();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.value.map((t) => `${t.schema}.${t.name}`).sort();
      expect(names).toContain('public.orders');
      expect(names).toContain('public.users');
    }
  });

  it('parses recorded storage/buckets into BucketSnapshot[] with correct public flag', async () => {
    const buckets = await loadSnapshot('buckets.json');
    const fetchImpl = makeSnapshotFetch({
      [`/v1/projects/${FAKE_REF}/storage/buckets`]: buckets,
    });
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl,
    });
    const storage = createSupabaseRestStorage(id('supabase-rest'), client);
    const r = await storage.fetchBuckets();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const map = new Map(r.value.map((b) => [b.name, b.public]));
      expect(map.get('avatars')).toBe(true);
      expect(map.get('user-files')).toBe(false);
    }
  });

  it('parses recorded config/storage into StorageConfig', async () => {
    const cfg = await loadSnapshot('storage-config.json');
    const fetchImpl = makeSnapshotFetch({
      [`/v1/projects/${FAKE_REF}/config/storage`]: cfg,
    });
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl,
    });
    const storage = createSupabaseRestStorage(id('supabase-rest'), client);
    const r = await storage.fetchStorageConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fileSizeLimit).toBe(52428800);
      expect(r.value.imageTransformEnabled).toBe(true);
    }
  });

  it('fetchPolicies always returns capability_not_exposed (honest REST limitation)', async () => {
    const fetchImpl = makeSnapshotFetch({});
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl,
    });
    const db = createSupabaseRestDatabase(id('supabase-rest'), client);
    const r = await db.fetchPolicies();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability_not_exposed');
      expect(r.error.message).toContain('REST does not expose');
    }
  });
});

describe('supabase-rest parsers — unit shape', () => {
  it('parseTablesFromOpenApi falls back to capability_not_exposed-shaped parse_error on bad input', () => {
    const r = parseTablesFromOpenApi({ swagger: '2.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('parse_error');
  });

  it('parseBuckets returns parse_error when body is not an array', () => {
    const r = parseBuckets({ buckets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('parse_error');
  });

  it('parseStorageConfig tolerates either fileSizeLimit casing', () => {
    const a = parseStorageConfig({ fileSizeLimit: 1024 });
    const b = parseStorageConfig({ file_size_limit: 2048 });
    expect(a.ok && a.value.fileSizeLimit).toBe(1024);
    expect(b.ok && b.value.fileSizeLimit).toBe(2048);
  });
});

const LIVE = process.env['VEYRA_LIVE_TESTS'] === '1';

describe.skipIf(!LIVE)('supabase-rest contract — LIVE (VEYRA_LIVE_TESTS=1)', () => {
  it('hits the real database/openapi endpoint and returns 200', async () => {
    const ref = process.env['SUPABASE_PROJECT_REF'];
    const token = process.env['SUPABASE_ACCESS_TOKEN'];
    if (ref === undefined || token === undefined) {
      throw new Error(
        'VEYRA_LIVE_TESTS=1 requires SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN to be set',
      );
    }
    const client = createSupabaseRestClient({
      projectRef: ref,
      accessToken: token,
      policy: defaultReadOnlyEvidencePolicy('local'),
    });
    const r = await client.getDatabaseOpenApi();
    expect(r.ok).toBe(true);
    // Sanity: live URL is the same as what we test against in snapshot mode.
    expect(SUPABASE_REST_BASE_URL).toBe('https://api.supabase.com');
  });
});
