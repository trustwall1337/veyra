import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AiProvider, AiRequest, AiResponse } from '../../ai/types.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';
import { asProviderId } from '../../types/identity.js';
import { ok, type Result } from '../../types/result.js';
import { AiProviderError } from '../../ai/types.js';

import {
  PROPOSED_PLAN_ARTIFACT,
  createAiSecurityPlannerAgent,
  MANDATORY_BASELINE_CONTROL_IDS,
} from './agent.js';
import { getCatalogControlIds } from '../sandbox-runner/test-catalog/index.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-asp-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function providerId(s: string) {
  const r = asProviderId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function fakeContext() {
  return {
    scanId: 'plan-scan-1',
    projectRoot: workdir,
    artifactDir: workdir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function fakeAiProvider(
  parsed: unknown,
): AiProvider {
  return {
    id: providerId('test-fake-ai'),
    async complete(_request: AiRequest): Promise<Result<AiResponse, AiProviderError>> {
      return ok({
        model_id: 'fake',
        output_text: JSON.stringify(parsed),
        parsed_output: parsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    },
  };
}

describe('AI security planner — deterministic fallback', () => {
  it('aiDisabled=true → produces the deterministic baseline (no AI call)', async () => {
    const findingsPath = path.join(workdir, 'findings.json');
    const dcPath = path.join(workdir, 'declared-context.json');
    await writeFile(findingsPath, '{"findings":[]}', 'utf8');
    await writeFile(dcPath, '{}', 'utf8');

    const agent = createAiSecurityPlannerAgent();
    const r = await agent.run(
      { aiDisabled: true, findingsPath, declaredContextPath: dcPath },
      fakeContext(),
    );
    expect(r.status).toBe('completed');
    expect(r.output?.deterministic_fallback).toBe(true);
    const entryControls = r.output?.proposed.entries.map((e) => e.control_id) ?? [];
    for (const baseline of MANDATORY_BASELINE_CONTROL_IDS) {
      expect(entryControls).toContain(baseline);
    }
  });

  it('aiProvider undefined → deterministic fallback', async () => {
    const findingsPath = path.join(workdir, 'findings.json');
    await writeFile(findingsPath, '{"findings":[]}', 'utf8');
    const agent = createAiSecurityPlannerAgent();
    const r = await agent.run(
      {
        aiDisabled: false,
        findingsPath,
        declaredContextPath: path.join(workdir, 'nope.json'),
      },
      fakeContext(),
    );
    expect(r.output?.deterministic_fallback).toBe(true);
  });
});

describe('AI security planner — planner-output-is-subset-of-catalog (constraint 4)', () => {
  it('silently drops entries with control_ids that are NOT in the catalog', async () => {
    const findingsPath = path.join(workdir, 'findings.json');
    await writeFile(findingsPath, '{"findings":[]}', 'utf8');

    const aiOutput = {
      entries: [
        // Valid:
        {
          test_id: 't-1',
          control_id: 'cc-11-5',
          priority: 'high',
          justification: 'RLS check',
        },
        // Invalid — invented test type (constraint 4 violation):
        {
          test_id: 't-bad',
          control_id: 'cc-invented-by-ai',
          priority: 'medium',
          justification: 'AI hallucination',
        },
        // Valid:
        {
          test_id: 't-3',
          control_id: 'cc-11-2',
          priority: 'low',
          justification: 'admin-route check',
        },
      ],
    };

    const agent = createAiSecurityPlannerAgent();
    const r = await agent.run(
      {
        aiDisabled: false,
        aiProvider: fakeAiProvider(aiOutput),
        findingsPath,
        declaredContextPath: path.join(workdir, 'nope.json'),
      },
      fakeContext(),
    );

    expect(r.status).toBe('completed');
    expect(r.output?.deterministic_fallback).toBe(false);
    const ids = r.output?.proposed.entries.map((e) => e.control_id) ?? [];
    expect(ids).toContain('cc-11-5');
    expect(ids).toContain('cc-11-2');
    expect(ids).not.toContain('cc-invented-by-ai');
    // Every output id IS in the catalog
    const catalogIds = new Set(getCatalogControlIds());
    for (const id of ids) expect(catalogIds.has(id)).toBe(true);
  });
});

describe('AI security planner — persistence', () => {
  it('writes proposed-scan-plan.json under artifactDir', async () => {
    const findingsPath = path.join(workdir, 'findings.json');
    await writeFile(findingsPath, '{"findings":[]}', 'utf8');
    const agent = createAiSecurityPlannerAgent();
    await agent.run(
      { aiDisabled: true, findingsPath, declaredContextPath: path.join(workdir, 'x.json') },
      fakeContext(),
    );
    const text = await readFile(path.join(workdir, PROPOSED_PLAN_ARTIFACT), 'utf8');
    const plan = JSON.parse(text) as { entries: { control_id: string }[] };
    expect(plan.entries.length).toBeGreaterThan(0);
  });
});
