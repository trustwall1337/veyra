import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AiProvider, AiRequest, AiResponse } from '../../ai/types.js';
import { AiProviderError } from '../../ai/types.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';
import { asProviderId } from '../../types/identity.js';
import { ok, type Result } from '../../types/result.js';
import type { Finding } from '../../types/finding.js';

import { AI_ENRICHMENTS_ARTIFACT, createAiExplainerAgent } from './agent.js';

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'veyra-aix-test-'));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function providerId(s: string) {
  const r = asProviderId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function ctx() {
  return {
    scanId: 'aix-scan-1',
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

function fakeProvider(parsed: unknown): AiProvider {
  return {
    id: providerId('test-fake-ai'),
    async complete(_r: AiRequest): Promise<Result<AiResponse, AiProviderError>> {
      return ok({
        model_id: 'test-model-v1',
        output_text: JSON.stringify(parsed),
        parsed_output: parsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 20 },
      });
    },
  };
}

const finding: Finding = {
  id: 'f-1',
  control_id: 'cc-11-5',
  finding_type: 'likely_issue',
  evidence_strength: 'medium',
  reproducibility: 'mcp_context',
  review_action: 'review_before_launch',
  blast_radius: 'tenant_data',
  title: 'orders table missing RLS',
  summary: 'RLS predicate did not detect ENABLE ROW LEVEL SECURITY on public.orders.',
  evidence_refs: [],
};

describe('ai-explainer — --no-ai short-circuit (§4.10)', () => {
  it('aiDisabled=true → no artifact, output.skipped=true', async () => {
    const r = await createAiExplainerAgent().run(
      { findings: [finding], aiDisabled: true },
      ctx(),
    );
    expect(r.status).toBe('completed');
    expect(r.output?.skipped).toBe(true);
    expect(r.artifacts.length).toBe(0);
  });

  it('aiProvider undefined → skipped (orchestrator still finishes)', async () => {
    const r = await createAiExplainerAgent().run(
      { findings: [finding], aiDisabled: false },
      ctx(),
    );
    expect(r.output?.skipped).toBe(true);
  });
});

describe('ai-explainer — happy path (§10.5 confidence + uncertainty_notes)', () => {
  it('every enrichment carries confidence + uncertainty_notes + model_id', async () => {
    const r = await createAiExplainerAgent().run(
      {
        findings: [finding],
        aiDisabled: false,
        aiProvider: fakeProvider({
          explanation: 'RLS off lets cross-tenant reads through.',
          suggested_tests_refined: [
            'GET /rest/v1/orders as tenant-A actor; expect rows scoped to tenant A only.',
          ],
          control_card_narrative: 'Enable RLS on orders.',
          confidence: 'medium',
          uncertainty_notes: 'The agent did not directly query the table.',
        }),
      },
      ctx(),
    );
    expect(r.output?.enrichments.length).toBe(1);
    const e = r.output?.enrichments[0];
    expect(e?.confidence).toBe('medium');
    expect(e?.uncertainty_notes.length).toBeGreaterThan(0);
    expect(e?.model_id).toBe('test-model-v1');
  });

  it('NEVER writes finding_type / evidence_strength / review_action / blast_radius (§10.2)', async () => {
    await createAiExplainerAgent().run(
      {
        findings: [finding],
        aiDisabled: false,
        aiProvider: fakeProvider({
          explanation: 'x',
          suggested_tests_refined: [],
          control_card_narrative: 'y',
          confidence: 'low',
          uncertainty_notes: 'z',
        }),
      },
      ctx(),
    );
    const text = await readFile(
      path.join(workdir, AI_ENRICHMENTS_ARTIFACT),
      'utf8',
    );
    const json = JSON.parse(text) as { enrichments: Record<string, unknown>[] };
    const e = json.enrichments[0]!;
    // Classification fields must NOT appear in the enrichment.
    expect(e['finding_type']).toBeUndefined();
    expect(e['evidence_strength']).toBeUndefined();
    expect(e['review_action']).toBeUndefined();
    expect(e['blast_radius']).toBeUndefined();
    expect(e['readiness_status']).toBeUndefined();
  });

  it('confidence is normalized to one of low|medium|high', async () => {
    const r = await createAiExplainerAgent().run(
      {
        findings: [finding],
        aiDisabled: false,
        aiProvider: fakeProvider({
          explanation: 'x',
          suggested_tests_refined: [],
          control_card_narrative: 'y',
          confidence: 'absolutely-certain', // garbage
          uncertainty_notes: 'z',
        }),
      },
      ctx(),
    );
    expect(r.output?.enrichments[0]?.confidence).toBe('low');
  });
});
