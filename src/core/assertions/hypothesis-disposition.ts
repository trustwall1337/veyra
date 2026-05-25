/**
 * Pass-2 hypothesis-disposition module (revision §4.2 rules 1–5).
 *
 * The sole emitter of `AIConcern` (constraint 7 enforced at module
 * ownership). Pure function — no I/O, no provider calls. The
 * orchestrator (18b) calls into this module after Pass-1 finishes;
 * agents do not call into it directly.
 *
 * Signature accepts only Findings + Hypotheses + (optional) sets that
 * the orchestrator already computed. No Hypothesis flows back to a
 * Pass-1 predicate; no AIConcern flows back to a Finding.
 */

import type { AIConcern } from '../../types/ai-concern.js';
import type { ContextRequest } from '../../types/context-request.js';
import type { Finding } from '../../types/finding.js';
import type {
  Hypothesis,
  HypothesisRef,
} from '../../types/hypothesis.js';

/** Outcome record in `assertions.json` per hypothesis. */
export type DispositionOutcome =
  | { readonly kind: 'attached_to_finding'; readonly finding_id: string }
  | { readonly kind: 'predicate_contradicted' }
  | { readonly kind: 'context_requested'; readonly request_id: string }
  | { readonly kind: 'ai_concern_emitted'; readonly concern_id: string };

export interface DispositionRecord {
  readonly hypothesis_id: string;
  readonly outcome: DispositionOutcome;
}

export interface DispositionInput {
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  /**
   * Hypothesis ids whose context requests already exhausted the retry
   * cap. The orchestrator owns the retry counter (see 08c); when
   * exhausted those hypotheses fall through to rule 4 (AIConcern).
   */
  readonly contextRetryExhausted?: ReadonlySet<string>;
}

export interface DispositionOutput {
  /**
   * Updated Finding[] — each Finding may gain new
   * supporting_hypothesis_refs entries. Original classification is
   * never changed.
   */
  readonly findings: readonly Finding[];
  readonly aiConcerns: readonly AIConcern[];
  /** Hypotheses that still need orchestrator-level retry (rule 3). */
  readonly contextRequestsToRetry: readonly {
    readonly hypothesis_id: string;
    readonly request: ContextRequest;
  }[];
  readonly assertions: readonly DispositionRecord[];
}

function evidenceRefSet(finding: Finding): ReadonlySet<string> {
  return new Set(finding.evidence_refs);
}

function findMatchingFinding(
  hyp: Hypothesis,
  findings: readonly Finding[],
): Finding | undefined {
  if (hyp.proposed_control_id === undefined) return undefined;
  for (const f of findings) {
    if (f.control_id !== hyp.proposed_control_id) continue;
    const refSet = evidenceRefSet(f);
    // Rule 1: hypothesis matches when its evidence_refs ⊆ Finding's
    // evidence_refs. Empty hypothesis-refs do not satisfy the subset
    // requirement in this strict reading; they fall through to rule 2
    // for the "contradicted" log.
    if (hyp.evidence_refs.length === 0) continue;
    const allInFinding = hyp.evidence_refs.every((r) => refSet.has(r.fact_id));
    if (allInFinding) return f;
  }
  return undefined;
}

function controlHasFinding(
  hyp: Hypothesis,
  findings: readonly Finding[],
): boolean {
  if (hyp.proposed_control_id === undefined) return false;
  return findings.some((f) => f.control_id === hyp.proposed_control_id);
}

function makeConcernId(hyp: Hypothesis, suffix: string): string {
  return `concern-${hyp.hypothesis_id}-${suffix}`;
}

function emitAiConcern(
  hyp: Hypothesis,
  category: AIConcern['category'],
): AIConcern {
  return {
    concern_id: makeConcernId(hyp, category),
    originating_hypothesis_id: hyp.hypothesis_id,
    category,
    reasoning: hyp.reasoning,
    confidence: hyp.confidence,
    evidence_refs: hyp.evidence_refs,
    uncertainty_notes: hyp.uncertainty_notes,
    suggested_human_review: '',
    model_id: hyp.model_id,
  };
}

function attachToFinding(finding: Finding, hyp: Hypothesis): Finding {
  const existing = finding.supporting_hypothesis_refs ?? [];
  const ref: HypothesisRef = { hypothesis_id: hyp.hypothesis_id };
  return {
    ...finding,
    supporting_hypothesis_refs: [...existing, ref],
  };
}

/**
 * Apply revision §4.2 rules 1–5 to the Pass-1 outputs.
 *
 * Each hypothesis lands in exactly one outcome. Outcomes:
 *  - rule 1 → attach to a matching Finding (no AIConcern emitted)
 *  - rule 2 → predicate_contradicted (audit only, no AIConcern)
 *  - rule 3 → context_requested (orchestrator retries)
 *  - rule 4 → AIConcern (no_predicate_fired or insufficient_facts)
 *  - rule 5 → AIConcern (no_predicate_fired) for informational hypotheses
 */
export function disposeHypotheses(
  input: DispositionInput,
): DispositionOutput {
  const findingsById = new Map(input.findings.map((f) => [f.id, f]));
  // Track per-finding accumulated refs so multiple hypotheses pointing
  // at the same Finding all attach.
  const aiConcerns: AIConcern[] = [];
  const contextRequestsToRetry: {
    hypothesis_id: string;
    request: ContextRequest;
  }[] = [];
  const assertions: DispositionRecord[] = [];

  const exhausted = input.contextRetryExhausted ?? new Set<string>();

  for (const hyp of input.hypotheses) {
    // Rule 5: informational hypotheses → AIConcern even when a
    // Finding exists for the same control_id (they're notes, not
    // claims of badness).
    if (hyp.proposed_finding_type === 'informational') {
      const c = emitAiConcern(hyp, 'no_predicate_fired');
      aiConcerns.push(c);
      assertions.push({
        hypothesis_id: hyp.hypothesis_id,
        outcome: { kind: 'ai_concern_emitted', concern_id: c.concern_id },
      });
      continue;
    }

    // Rule 1: try to attach to a Finding that has all of the
    // hypothesis's evidence_refs.
    const match = findMatchingFinding(hyp, input.findings);
    if (match !== undefined) {
      const updated = attachToFinding(match, hyp);
      findingsById.set(match.id, updated);
      assertions.push({
        hypothesis_id: hyp.hypothesis_id,
        outcome: { kind: 'attached_to_finding', finding_id: match.id },
      });
      continue;
    }

    // Rule 2: a Finding exists for the same control_id but the
    // evidence shape did not match → predicate_contradicted (audit
    // only). No AIConcern.
    if (controlHasFinding(hyp, input.findings)) {
      assertions.push({
        hypothesis_id: hyp.hypothesis_id,
        outcome: { kind: 'predicate_contradicted' },
      });
      continue;
    }

    // Rule 3: hypothesis declared `requires_context` and the retry
    // cap has NOT yet been exhausted → emit a context request for the
    // orchestrator to route.
    if (
      hyp.requires_context !== undefined &&
      !exhausted.has(hyp.hypothesis_id)
    ) {
      contextRequestsToRetry.push({
        hypothesis_id: hyp.hypothesis_id,
        request: hyp.requires_context,
      });
      assertions.push({
        hypothesis_id: hyp.hypothesis_id,
        outcome: {
          kind: 'context_requested',
          request_id: hyp.requires_context.request_id,
        },
      });
      continue;
    }

    // Rule 4: no Finding + (no context request OR retries exhausted)
    // → AIConcern. The category is `no_predicate_fired` when the
    // control_id is set; `insufficient_facts` when the hypothesis
    // cited evidence but no Finding referenced those facts.
    const category: AIConcern['category'] =
      hyp.evidence_refs.length === 0
        ? 'no_predicate_fired'
        : 'insufficient_facts';
    const concern = emitAiConcern(hyp, category);
    aiConcerns.push(concern);
    assertions.push({
      hypothesis_id: hyp.hypothesis_id,
      outcome: { kind: 'ai_concern_emitted', concern_id: concern.concern_id },
    });
  }

  return {
    findings: Array.from(findingsById.values()),
    aiConcerns,
    contextRequestsToRetry,
    assertions,
  };
}
