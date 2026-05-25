import { describe, expect, it } from 'vitest';

import { asPromptTemplateId } from '../../types/prompt-template.js';
import type { Finding } from '../../types/finding.js';
import type { Hypothesis } from '../../types/hypothesis.js';

import { disposeHypotheses } from './hypothesis-disposition.js';

function hyp(overrides: Partial<Hypothesis> & Pick<Hypothesis, 'hypothesis_id'>): Hypothesis {
  return {
    source: 'ai_inference',
    evidence_refs: [],
    reasoning: 'r',
    confidence: 'medium',
    uncertainty_notes: 'n',
    model_id: 'm',
    prompt_fingerprint_sha256: '0'.repeat(64),
    ...overrides,
  };
}

function finding(
  overrides: Partial<Finding> & Pick<Finding, 'control_id' | 'id'>,
): Finding {
  return {
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: 't',
    summary: 's',
    evidence_refs: [],
    ...overrides,
  };
}

describe('rule 1 — hypothesis matches a Finding (evidence_refs ⊆ Finding.evidence_refs)', () => {
  it('attaches the hypothesis as a supporting_hypothesis_ref', () => {
    const r = disposeHypotheses({
      findings: [
        finding({
          id: 'f1',
          control_id: 'cc-11-5',
          evidence_refs: ['fact-1', 'fact-2'],
        }),
      ],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-5',
          evidence_refs: [{ fact_id: 'fact-1' }],
        }),
      ],
    });
    const updated = r.findings.find((f) => f.id === 'f1');
    expect(updated?.supporting_hypothesis_refs?.[0]?.hypothesis_id).toBe('h1');
    expect(r.aiConcerns).toEqual([]);
    expect(r.assertions[0]?.outcome.kind).toBe('attached_to_finding');
  });
});

describe('rule 2 — finding exists but evidence shape does not match', () => {
  it('logs predicate_contradicted; emits NO AIConcern', () => {
    const r = disposeHypotheses({
      findings: [
        finding({
          id: 'f1',
          control_id: 'cc-11-3',
          evidence_refs: ['fact-real'],
        }),
      ],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-3',
          evidence_refs: [{ fact_id: 'fact-different' }],
        }),
      ],
    });
    expect(r.aiConcerns).toEqual([]);
    expect(r.assertions[0]?.outcome.kind).toBe('predicate_contradicted');
  });
});

describe('rule 3 — no Finding + requires_context', () => {
  it('emits a context request for the orchestrator to retry', () => {
    const tpl = asPromptTemplateId('templates.project_overview');
    if (!tpl.ok) throw tpl.error;
    const r = disposeHypotheses({
      findings: [],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-9',
          evidence_refs: [{ fact_id: 'fact-x' }],
          requires_context: {
            request_id: 'req-1',
            for_hypothesis_id: 'h1',
            justification: 'need more',
            kind: 'send_message_template',
            args: {
              kind: 'send_message_template',
              template_id: tpl.value,
            },
          },
        }),
      ],
    });
    expect(r.contextRequestsToRetry).toHaveLength(1);
    expect(r.contextRequestsToRetry[0]?.request.request_id).toBe('req-1');
    expect(r.aiConcerns).toEqual([]);
  });

  it('falls through to rule 4 when the retry cap is exhausted', () => {
    const tpl = asPromptTemplateId('templates.project_overview');
    if (!tpl.ok) throw tpl.error;
    const r = disposeHypotheses({
      findings: [],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-9',
          evidence_refs: [{ fact_id: 'fact-x' }],
          requires_context: {
            request_id: 'req-2',
            for_hypothesis_id: 'h1',
            justification: 'need more',
            kind: 'send_message_template',
            args: {
              kind: 'send_message_template',
              template_id: tpl.value,
            },
          },
        }),
      ],
      contextRetryExhausted: new Set(['h1']),
    });
    expect(r.contextRequestsToRetry).toEqual([]);
    expect(r.aiConcerns).toHaveLength(1);
    expect(r.aiConcerns[0]?.category).toBe('insufficient_facts');
  });
});

describe('rule 4 — no Finding + no context request', () => {
  it('emits an AIConcern with category=insufficient_facts when hypothesis cites refs', () => {
    const r = disposeHypotheses({
      findings: [],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-9',
          evidence_refs: [{ fact_id: 'fact-x' }],
        }),
      ],
    });
    expect(r.aiConcerns).toHaveLength(1);
    expect(r.aiConcerns[0]?.category).toBe('insufficient_facts');
  });

  it('emits an AIConcern with category=no_predicate_fired when the hypothesis cites zero refs', () => {
    const r = disposeHypotheses({
      findings: [],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-9',
          evidence_refs: [],
        }),
      ],
    });
    expect(r.aiConcerns[0]?.category).toBe('no_predicate_fired');
  });
});

describe('rule 5 — informational hypotheses → AIConcern even when a Finding exists', () => {
  it('does not attach to a Finding; emits AIConcern instead', () => {
    const r = disposeHypotheses({
      findings: [
        finding({
          id: 'f1',
          control_id: 'cc-11-5',
          evidence_refs: ['fact-1'],
        }),
      ],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-5',
          proposed_finding_type: 'informational',
          evidence_refs: [{ fact_id: 'fact-1' }],
        }),
      ],
    });
    expect(r.aiConcerns).toHaveLength(1);
    expect(r.aiConcerns[0]?.category).toBe('no_predicate_fired');
    const f = r.findings.find((x) => x.id === 'f1');
    expect(f?.supporting_hypothesis_refs).toBeUndefined();
  });
});

describe('audit spine — each hypothesis has exactly one recorded outcome', () => {
  it('assertions.length === hypotheses.length', () => {
    const r = disposeHypotheses({
      findings: [
        finding({ id: 'f1', control_id: 'cc-11-5', evidence_refs: ['fact-a'] }),
      ],
      hypotheses: [
        hyp({
          hypothesis_id: 'h1',
          proposed_control_id: 'cc-11-5',
          evidence_refs: [{ fact_id: 'fact-a' }],
        }),
        hyp({
          hypothesis_id: 'h2',
          proposed_control_id: 'cc-11-9',
          evidence_refs: [{ fact_id: 'fact-b' }],
        }),
        hyp({
          hypothesis_id: 'h3',
          proposed_control_id: 'cc-11-5',
          proposed_finding_type: 'informational',
          evidence_refs: [{ fact_id: 'fact-a' }],
        }),
      ],
    });
    expect(r.assertions.length).toBe(3);
  });
});
