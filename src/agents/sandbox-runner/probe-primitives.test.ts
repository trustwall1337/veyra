import { z } from 'zod';

import { describe, expect, it } from 'vitest';

import type { ProbePrimitive } from '../../types/probe-primitive.js';
import {
  WriteRegistry,
  executeWriteWithRegistry,
} from '../../core/sandbox/http-write-registry.js';

import { compileProbeRequest } from './probe-compiler.js';
import {
  classifyProbe,
  findingForOutcome,
} from './outcome-classifier.js';

// Sample probe: cc-11-3 IDOR — direct object access at /api/orders/{id} with a
// non-owning identity. The `id` placeholder is AI-authored (within schema:
// non-empty string, length ≤ 64, base36 or uuid-shape only). Method + URL
// template are fixed (preventer 9 — AI does not invent the test type).
const IDOR_PROBE: ProbePrimitive = {
  id: 'cc-11-3-direct-object-access',
  control_id: 'cc-11-3',
  title: 'Direct object access via /api/orders/{id}',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/api/orders/{id}' },
    pathParams: {
      id: {
        mode: 'ai_authored',
        schema: z.string().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/),
      },
    },
    bodySchema: z.undefined(),
  },
};

describe('Step 39 — probe primitive declares requestSchema (Verification a)', () => {
  it('declares aiAuthored vs fixed field markers', () => {
    expect(IDOR_PROBE.requestSchema.method.mode).toBe('fixed');
    expect(IDOR_PROBE.requestSchema.urlTemplate.mode).toBe('fixed');
    expect(IDOR_PROBE.requestSchema.pathParams['id']?.mode).toBe('ai_authored');
  });
});

describe('Step 39 — compileProbeRequest (Verification b/c/d)', () => {
  it('accepts an AI-authored id within schema bounds', () => {
    const compiled = compileProbeRequest(IDOR_PROBE, {
      method: 'GET',
      path_params: { id: 'order-9z' },
      body: undefined,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.method).toBe('GET');
    expect(compiled.url).toBe('/api/orders/order-9z');
  });

  it('rejects an AI attempt to override the fixed method (b)', () => {
    const compiled = compileProbeRequest(IDOR_PROBE, {
      method: 'POST',
      path_params: { id: 'x' },
      body: undefined,
    });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.reason).toContain('method is fixed');
  });

  it('rejects an AI path-param outside the schema regex (d)', () => {
    const compiled = compileProbeRequest(IDOR_PROBE, {
      method: 'GET',
      path_params: { id: '../etc/passwd' },
      body: undefined,
    });
    expect(compiled.ok).toBe(false);
  });

  it('rejects a body outside the declared bodySchema (c, injection guard)', () => {
    const compiled = compileProbeRequest(IDOR_PROBE, {
      method: 'GET',
      path_params: { id: 'order-1' },
      body: { malicious: 'payload' },
    });
    expect(compiled.ok).toBe(false);
  });
});

describe('Step 39 — every write goes through executeWriteWithRegistry (Verification e)', () => {
  it('a probe issuing a mutating request records and sends through the wrapper', async () => {
    const reg = new WriteRegistry();
    let observedAtSend = -1;
    const transport = {
      send: async () => {
        observedAtSend = reg.list().length;
        return { ok: true };
      },
    };
    await executeWriteWithRegistry({
      registry: reg,
      transport,
      request: {
        method: 'POST',
        url: '/api/orders',
        body_redacted: '{...}',
      },
      resource_id: '/api/orders/probe-1',
      description_redacted: 'probe POST',
    });
    expect(observedAtSend).toBe(1);
    expect(reg.list()).toHaveLength(1);
  });
});

describe('Step 39 — outcome classifier joins the floor (Verification f)', () => {
  it('classifies an expect_denial probe that returned 200 as proven_allowed → confirmed_issue', () => {
    const obs = {
      probe_id: IDOR_PROBE.id,
      control_id: IDOR_PROBE.control_id,
      response_status: 200,
      response_returned_rows: true,
      expectation: 'expect_denial' as const,
    };
    expect(classifyProbe(obs)).toBe('proven_allowed');
    const f = findingForOutcome(obs, 'proven_allowed');
    expect(f?.finding_type).toBe('confirmed_issue');
    expect(f?.review_action).toBe('fix_before_launch');
  });

  it('classifies an expect_denial probe that returned 403 as proven_denial → no finding', () => {
    const obs = {
      probe_id: IDOR_PROBE.id,
      control_id: IDOR_PROBE.control_id,
      response_status: 403,
      response_returned_rows: false,
      expectation: 'expect_denial' as const,
    };
    expect(classifyProbe(obs)).toBe('proven_denial');
    expect(findingForOutcome(obs, 'proven_denial')).toBeUndefined();
  });

  it('is deterministic — same observation → same outcome', () => {
    const obs = {
      probe_id: IDOR_PROBE.id,
      control_id: IDOR_PROBE.control_id,
      expectation: 'expect_denial' as const,
    };
    expect(classifyProbe(obs)).toBe('inconclusive');
    expect(classifyProbe(obs)).toBe('inconclusive');
  });
});
