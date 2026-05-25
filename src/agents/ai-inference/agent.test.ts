import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AiProvider,
  AiRequest,
  AiResponse,
} from '../../ai/types.js';
import { asProviderId, asScannerId } from '../../types/identity.js';
import { isErr, isOk, ok } from '../../types/result.js';
import type { ScanFact } from '../../types/scan-fact.js';

import {
  HYPOTHESES_ARTIFACT_NAME,
  runAiInference,
  writeHypothesesArtifact,
} from './agent.js';
import type { AiInferenceLogEntry } from './types.js';

function fact(id: string): ScanFact {
  const sid = asScannerId('gitleaks');
  if (!sid.ok) throw sid.error;
  return {
    fact_id: id,
    source: {
      kind: 'scanner_match',
      scanner_id: sid.value,
      payload: {
        sanitized_excerpt: 'sanitized',
        content_kind: 'text',
      },
    },
    file_path: 'src/x.ts',
    line: 1,
    observed_at: '2026-05-25T00:00:00Z',
    args_fingerprint_sha256: 'x',
    redacted: true,
  };
}

function provider(parsed: unknown): AiProvider {
  const id = asProviderId('anthropic');
  if (!id.ok) throw id.error;
  return {
    id: id.value,
    complete: async (_req: AiRequest) => {
      const r: AiResponse = {
        model_id: 'claude-sonnet-4-6',
        output_text: '',
        parsed_output: parsed,
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return ok(r);
    },
  };
}

function providerSequence(parsed: unknown[]): AiProvider {
  const id = asProviderId('anthropic');
  if (!id.ok) throw id.error;
  let i = 0;
  return {
    id: id.value,
    complete: async (_req: AiRequest) => {
      const p = parsed[Math.min(i, parsed.length - 1)];
      i += 1;
      const r: AiResponse = {
        model_id: 'm',
        output_text: '',
        parsed_output: p,
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      return ok(r);
    },
  };
}

describe('runAiInference — citation invariant', () => {
  it('every emitted hypothesis cites at least one known fact_id', async () => {
    const facts = [fact('f1'), fact('f2')];
    const p = provider({
      hypotheses: [
        {
          proposed_finding_type: 'likely_issue',
          evidence_refs: [{ fact_id: 'f1' }],
          reasoning: 'r',
          confidence: 'medium',
          uncertainty_notes: 'n',
        },
      ],
    });
    const r = await runAiInference({
      scanFacts: facts,
      provider: p,
      model: 'claude-sonnet-4-6',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.hypotheses).toHaveLength(1);
      expect(r.value.hypotheses[0]?.evidence_refs[0]?.fact_id).toBe('f1');
    }
  });

  it('rejects hypotheses that cite unknown fact_ids (retries then discards)', async () => {
    const facts = [fact('f1')];
    const bad = {
      hypotheses: [
        {
          evidence_refs: [{ fact_id: 'unknown-fact' }],
          reasoning: 'r',
          confidence: 'medium',
          uncertainty_notes: 'n',
        },
      ],
    };
    const p = providerSequence([bad, bad, bad]);
    const log: AiInferenceLogEntry[] = [];
    const r = await runAiInference({
      scanFacts: facts,
      provider: p,
      model: 'm',
      actionLog: (e) => log.push(e),
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.hypotheses).toHaveLength(0);
      expect(r.value.schemaViolations).toBeGreaterThanOrEqual(2);
    }
    expect(log.some((e) => e.event === 'schema_violation')).toBe(true);
  });
});

describe('runAiInference — budget enforcement', () => {
  it('truncates to the configured hypothesis budget', async () => {
    const facts = [fact('f1')];
    const ten = Array.from({ length: 10 }, (_x, i) => ({
      evidence_refs: [{ fact_id: 'f1' }],
      reasoning: `r-${String(i)}`,
      confidence: 'medium' as const,
      uncertainty_notes: 'n',
    }));
    const p = provider({ hypotheses: ten });
    const log: AiInferenceLogEntry[] = [];
    const r = await runAiInference({
      scanFacts: facts,
      provider: p,
      model: 'm',
      hypothesisBudget: 5,
      actionLog: (e) => log.push(e),
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.hypotheses).toHaveLength(5);
      expect(r.value.budgetExhausted).toBe(true);
    }
    expect(log.some((e) => e.event === 'budget_exhausted')).toBe(true);
  });
});

describe('runAiInference — output contract', () => {
  it('every hypothesis carries model_id, prompt_fingerprint, confidence, uncertainty_notes', async () => {
    const facts = [fact('f1')];
    const p = provider({
      hypotheses: [
        {
          evidence_refs: [{ fact_id: 'f1' }],
          reasoning: 'r',
          confidence: 'low',
          uncertainty_notes: 'note',
        },
      ],
    });
    const r = await runAiInference({
      scanFacts: facts,
      provider: p,
      model: 'm',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const h = r.value.hypotheses[0];
      expect(h?.model_id).toBeDefined();
      expect(h?.prompt_fingerprint_sha256.length).toBe(64);
      expect(h?.confidence).toBe('low');
      expect(h?.uncertainty_notes).toBe('note');
      expect(h?.source).toBe('ai_inference');
    }
  });
});

describe('writeHypothesesArtifact', () => {
  it('writes hypotheses.json without an embedded `findings` field (constraint 7)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-ai-inf-'));
    const w = await writeHypothesesArtifact(dir, {
      hypotheses: [
        {
          hypothesis_id: 'h1',
          source: 'ai_inference',
          evidence_refs: [{ fact_id: 'f1' }],
          reasoning: 'r',
          confidence: 'low',
          uncertainty_notes: 'note',
          model_id: 'm',
          prompt_fingerprint_sha256: '0'.repeat(64),
        },
      ],
      contextRequests: [],
      budgetExhausted: false,
      schemaViolations: 0,
    });
    expect(isOk(w)).toBe(true);
    const text = await fs.readFile(
      path.join(dir, HYPOTHESES_ARTIFACT_NAME),
      'utf8',
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['hypotheses']).toBeDefined();
    expect(parsed['findings']).toBeUndefined();
  });
});

describe('provider error path', () => {
  it('returns err when the provider fails', async () => {
    const id = asProviderId('anthropic');
    if (!id.ok) throw id.error;
    const failing: AiProvider = {
      id: id.value,
      complete: async () => {
        const { err: errR } = await import('../../types/result.js');
        const { AiProviderError } = await import('../../ai/types.js');
        return errR(new AiProviderError('boom', 'network_error'));
      },
    };
    const r = await runAiInference({
      scanFacts: [fact('f1')],
      provider: failing,
      model: 'm',
    });
    expect(isErr(r)).toBe(true);
  });
});
