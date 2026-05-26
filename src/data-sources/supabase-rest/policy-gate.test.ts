/**
 * Policy-gate tests for the Supabase REST client (step 27).
 *
 * These assertions are the test surface for Done-When #7: "Every REST
 * call goes through `policy.allowed_actions.has('<action>')` before
 * sending. A test asserts that flipping an action off prevents the
 * corresponding endpoint family from being called." No `if (mode ===
 * 'read_only_evidence')` branches anywhere in `src/data-sources/`.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultReadOnlyEvidencePolicy,
  type ValidationPolicy,
  type AllowedAction,
} from '../../types/validation-policy.js';

import { createSupabaseRestClient, SUPABASE_REST_BASE_URL } from './client.js';

const FAKE_TOKEN = 'fake-test-token-do-not-store-anywhere-123abc';
const FAKE_REF = 'aukqmgjnoldnhrvsolhh';

function policyWithout(action: AllowedAction): ValidationPolicy {
  const base = defaultReadOnlyEvidencePolicy('local');
  const allowed = new Set(base.allowed_actions);
  allowed.delete(action);
  return { ...base, allowed_actions: allowed };
}

function makeFetchSpy() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init as RequestInit | undefined });
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, calls };
}

describe('supabase-rest client — capability gate (Done-When #7)', () => {
  it('database/openapi requires read_schema_metadata — denied policy short-circuits before fetch', async () => {
    const { impl, calls } = makeFetchSpy();
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: policyWithout('read_schema_metadata'),
      fetchImpl: impl,
    });
    const r = await client.getDatabaseOpenApi();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability_denied');
    expect(calls).toHaveLength(0);
  });

  it('storage/buckets requires read_storage_metadata — denied policy short-circuits before fetch', async () => {
    const { impl, calls } = makeFetchSpy();
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: policyWithout('read_storage_metadata'),
      fetchImpl: impl,
    });
    const r = await client.listStorageBuckets();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability_denied');
    expect(calls).toHaveLength(0);
  });

  it('config/storage requires read_storage_metadata — denied policy short-circuits before fetch', async () => {
    const { impl, calls } = makeFetchSpy();
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: policyWithout('read_storage_metadata'),
      fetchImpl: impl,
    });
    const r = await client.getStorageConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability_denied');
    expect(calls).toHaveLength(0);
  });

  it('default read_only_evidence policy lets database/openapi through', async () => {
    const { impl, calls } = makeFetchSpy();
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl: impl,
    });
    const r = await client.getDatabaseOpenApi();
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `${SUPABASE_REST_BASE_URL}/v1/projects/${FAKE_REF}/database/openapi`,
    );
  });
});

describe('supabase-rest client — secrets discipline (CLAUDE.md §Secrets)', () => {
  it('Authorization header carries the bearer token; argv-style channels never see it', async () => {
    const { impl, calls } = makeFetchSpy();
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl: impl,
    });
    await client.getDatabaseOpenApi();
    expect(calls).toHaveLength(1);
    const init = calls[0]?.init;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    // URL must not echo the token.
    expect(calls[0]?.url).not.toContain(FAKE_TOKEN);
  });

  it('redacts the token from transport_error messages when fetch itself throws', async () => {
    const errImpl: typeof fetch = async () => {
      throw new Error(`upstream saw token ${FAKE_TOKEN} in transit`);
    };
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl: errImpl,
    });
    const r = await client.getDatabaseOpenApi();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('transport_error');
      expect(r.error.message).not.toContain(FAKE_TOKEN);
      expect(r.error.message).toContain('REDACTED');
    }
  });

  it('redacts the token from HTTP-error body before surfacing', async () => {
    const httpErr: typeof fetch = async () =>
      new Response(`bad token ${FAKE_TOKEN}; rejected`, {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      });
    const client = createSupabaseRestClient({
      projectRef: FAKE_REF,
      accessToken: FAKE_TOKEN,
      policy: defaultReadOnlyEvidencePolicy('local'),
      fetchImpl: httpErr,
    });
    const r = await client.getDatabaseOpenApi();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability_denied');
      expect(r.error.message).not.toContain(FAKE_TOKEN);
    }
  });

  it('rejects empty token / empty project_ref at construction', () => {
    expect(() =>
      createSupabaseRestClient({
        projectRef: '',
        accessToken: FAKE_TOKEN,
        policy: defaultReadOnlyEvidencePolicy('local'),
      }),
    ).toThrow();
    expect(() =>
      createSupabaseRestClient({
        projectRef: FAKE_REF,
        accessToken: '',
        policy: defaultReadOnlyEvidencePolicy('local'),
      }),
    ).toThrow();
  });
});
