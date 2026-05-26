import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { asAnalyzerId, asConnectorId } from '../../types/identity.js';
import {
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';
import type { CompiledScanPlan } from '../../types/scan-plan.js';
import type { TestIdentity } from '../../types/active-validation.js';

import { ACTIVE_VALIDATION_RESULTS_ARTIFACT, createSandboxRunnerAgent } from './agent.js';
import type { HttpResponse, HttpTransport } from './test-catalog/types.js';

function analyzerId(s: string) {
  const r = asAnalyzerId(s);
  if (!r.ok) throw r.error;
  return r.value;
}
function connectorId(s: string) {
  const r = asConnectorId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-sr-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function fakeContext() {
  const policy = defaultSandboxActiveValidationPolicy('sandbox');
  if (!policy.ok) throw policy.error;
  return {
    scanId: 'sr-scan-1',
    projectRoot: workdir,
    artifactDir: workdir,
    policy: policy.value,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function actor(): TestIdentity {
  return {
    id: 'actor-1',
    scan_id: 'sr-scan-1',
    provider_subject_id: 'uid-1',
    identity_provider_id: connectorId('supabase-auth'),
    role: 'member',
    tenant_id: 't-A',
    created_at: '2026-05-26T00:00:00Z',
  };
}

function transport(response: HttpResponse): HttpTransport {
  return {
    async send() {
      return response;
    },
  };
}

function plan(controlId: string): CompiledScanPlan {
  return {
    scan_id: 'sr-scan-1',
    source_producer_id: analyzerId('deterministic-fallback'),
    entries: [
      {
        test_id: `t-${controlId}`,
        control_id: controlId,
        priority: 'medium',
        parameters: { url: 'https://example.invalid/rest/v1/orders' },
        justification: 'test',
        validated_target_ref: { kind: 'http_surface', ref: '*' },
        allowed_actions_satisfied: ['call_api_with_test_identity'],
      },
    ],
    compiled_at: '2026-05-26T00:00:00Z',
    baseline_injections: [],
  };
}

describe('sandbox-runner — per-test outcome detection', () => {
  it('HTTP 403 → proven_denial on cc-11-1', async () => {
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-1'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({
          status: 403,
          headers: {},
          body: {},
          bodyByteLength: 2,
        }),
      },
      fakeContext(),
    );
    expect(r.status).toBe('completed');
    expect(r.output?.results[0]?.outcome).toBe('proven_denial');
  });

  it('HTTP 200 with body → proven_allowed on cc-11-1', async () => {
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-1'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({
          status: 200,
          headers: {},
          body: { secret: 'data' },
          bodyByteLength: 20,
        }),
      },
      fakeContext(),
    );
    expect(r.output?.results[0]?.outcome).toBe('proven_allowed');
  });

  it('ambiguous response (HTTP 500) → inconclusive', async () => {
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-1'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({
          status: 500,
          headers: {},
          body: 'oops',
          bodyByteLength: 4,
        }),
      },
      fakeContext(),
    );
    expect(r.output?.results[0]?.outcome).toBe('inconclusive');
  });
});

describe('sandbox-runner — strictness (§12)', () => {
  it('vague body that does NOT match the assertion → inconclusive (cc-11-5)', async () => {
    // cc-11-5 requires Array body with at least one row whose
    // tenant_id != actor.tenant_id. An empty array → proven_denial.
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-5'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({
          status: 200,
          headers: {},
          body: 'not even an array',
          bodyByteLength: 17,
        }),
      },
      fakeContext(),
    );
    expect(r.output?.results[0]?.outcome).toBe('inconclusive');
  });
});

describe('sandbox-runner — timeout', () => {
  it('catalog test that exceeds per-test timeout → inconclusive with timeout reason', async () => {
    const slow: HttpTransport = {
      async send() {
        return new Promise<HttpResponse>(() => {
          // never resolves
        });
      },
    };
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-1'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: slow,
        perTestTimeoutMs: 50,
      },
      fakeContext(),
    );
    expect(r.output?.results[0]?.outcome).toBe('inconclusive');
    expect(r.output?.results[0]?.assertion_details['reason']).toBe('timeout');
  });
});

describe('sandbox-runner — per-scan budget', () => {
  it('remaining tests after budget exhaustion → inconclusive with budget_exceeded reason', async () => {
    // 3 entries; budget=0ms so the very first iteration trips the
    // budget gate before any test runs.
    const compiledPlan: CompiledScanPlan = {
      scan_id: 'sr-scan-1',
      source_producer_id: analyzerId('deterministic-fallback'),
      entries: [
        {
          test_id: 't-1',
          control_id: 'cc-11-1',
          priority: 'medium',
          parameters: { url: 'https://example.invalid/' },
          justification: '',
          validated_target_ref: { kind: 'http_surface', ref: '*' },
          allowed_actions_satisfied: ['call_api_with_test_identity'],
        },
        {
          test_id: 't-2',
          control_id: 'cc-11-1',
          priority: 'medium',
          parameters: { url: 'https://example.invalid/' },
          justification: '',
          validated_target_ref: { kind: 'http_surface', ref: '*' },
          allowed_actions_satisfied: ['call_api_with_test_identity'],
        },
      ],
      compiled_at: '2026-05-26T00:00:00Z',
      baseline_injections: [],
    };
    const r = await createSandboxRunnerAgent().run(
      {
        compiledPlan,
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({ status: 403, headers: {}, body: {}, bodyByteLength: 2 }),
        perScanBudgetMs: -1, // force immediate exhaustion
      },
      fakeContext(),
    );
    // All entries should be inconclusive/budget_exceeded.
    for (const res of r.output?.results ?? []) {
      expect(res.outcome).toBe('inconclusive');
      expect(res.assertion_details['reason']).toBe('budget_exceeded');
    }
  });
});

describe('sandbox-runner — persistence', () => {
  it('writes active-validation-results.json', async () => {
    await createSandboxRunnerAgent().run(
      {
        compiledPlan: plan('cc-11-1'),
        identities: [actor()],
        sessions: [{ test_id: 'actor-1', access_token: 'jwt-1' }],
        transport: transport({ status: 403, headers: {}, body: {}, bodyByteLength: 2 }),
      },
      fakeContext(),
    );
    const text = await readFile(
      path.join(workdir, ACTIVE_VALIDATION_RESULTS_ARTIFACT),
      'utf8',
    );
    const json = JSON.parse(text) as { scan_id: string; results: unknown[] };
    expect(json.scan_id).toBe('sr-scan-1');
    expect(json.results.length).toBe(1);
  });
});
