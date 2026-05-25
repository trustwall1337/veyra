import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { CHECKLIST, businessLogicAgent } from './agent.js';
import { evaluateChecklist } from './checklist.js';

function logger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-bl-'));
  return {
    scanId: 'scan',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: logger(),
  };
}

describe('CHECKLIST — invariants', () => {
  it('every item has a stable id and at least one suggested_test', () => {
    const ids = new Set<string>();
    for (const item of CHECKLIST) {
      expect(item.id).toMatch(/^bl-/);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.suggested_tests.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateChecklist — declared-context predicates', () => {
  it('applies the money/payment checklist when project declares payment data', () => {
    const r = evaluateChecklist({
      declared_intent: {
        data_kinds: { value: ['order', 'payment'], confidence: 'medium' },
      },
    });
    const ids = r.applicable.map((i) => i.id);
    expect(ids).toContain('bl-self-approval');
    expect(ids).toContain('bl-refund-reversal');
  });

  it('applies the tenant-transition checklist when project declares tenant roles', () => {
    const r = evaluateChecklist({
      declared_intent: {
        user_roles: { value: ['tenant_member', 'admin'], confidence: 'high' },
      },
    });
    const ids = r.applicable.map((i) => i.id);
    expect(ids).toContain('bl-cross-tenant-invite');
    expect(ids).toContain('bl-tenant-membership-transitions');
  });

  it('emits nothing when the declared context shows none of the categories', () => {
    const r = evaluateChecklist({
      declared_intent: {
        data_kinds: { value: ['unrelated'], confidence: 'low' },
      },
    });
    expect(r.applicable).toEqual([]);
  });
});

describe('businessLogicAgent — runtime guarantees', () => {
  it('NEVER emits a confirmed_issue (§4.5 invariant)', async () => {
    const c = await ctx();
    const r = await businessLogicAgent.run(
      {
        declaredContext: {
          declared_intent: {
            data_kinds: { value: ['payment', 'order', 'file'], confidence: 'medium' },
            user_roles: { value: ['admin', 'tenant_member'], confidence: 'medium' },
          },
        },
      },
      c,
    );
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('confirmed_issue');
    }
  });

  it('every emitted finding has at least one suggested_test', async () => {
    const c = await ctx();
    const r = await businessLogicAgent.run(
      {
        declaredContext: {
          declared_intent: {
            data_kinds: { value: ['payment'], confidence: 'medium' },
          },
        },
      },
      c,
    );
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect((f.suggested_test_ids ?? []).length).toBeGreaterThan(0);
    }
  });

  it('emits findings tagged finding_type: coverage_gap (negative tests missing)', async () => {
    const c = await ctx();
    const r = await businessLogicAgent.run(
      {
        declaredContext: {
          declared_intent: {
            data_kinds: { value: ['payment'], confidence: 'medium' },
          },
        },
      },
      c,
    );
    for (const f of r.findings) {
      expect(['coverage_gap', 'missing_evidence']).toContain(f.finding_type);
    }
  });

  it('is idempotent — same context produces identical findings on a second run', async () => {
    const c1 = await ctx();
    const c2 = await ctx();
    const input = {
      declaredContext: {
        declared_intent: {
          data_kinds: { value: ['order', 'payment'], confidence: 'medium' },
          user_roles: { value: ['admin'], confidence: 'medium' },
        },
      },
    };
    const a = await businessLogicAgent.run(input, c1);
    const b = await businessLogicAgent.run(input, c2);
    const aIds = a.findings.map((f) => f.id);
    const bIds = b.findings.map((f) => f.id);
    expect(aIds).toEqual(bIds);
  });
});
