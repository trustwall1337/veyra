/**
 * `Hypothesis` — AI Inference Layer output.
 *
 * Per AI-shape revision §3.2:
 *
 *  - Producer: AI Inference Agent.
 *  - Consumers: Assertion Layer (decides Finding vs AIConcern),
 *    Reporter (renders AIConcern entries).
 *  - Lives in this file; written to the `hypotheses` artifact.
 *
 * A `Hypothesis` is **never** a `Finding`. It either becomes evidence
 * on a deterministically-produced Finding (when the predicate fires),
 * becomes an `AIConcern` (when no predicate fires), or is discarded
 * (when the deterministic predicate explicitly contradicts it).
 *
 * Trust-model constraints embedded in the type:
 *
 *  - `proposed_finding_type` is closed to `'likely_issue' | 'informational'`.
 *    AI **cannot** propose `confirmed_issue`, `missing_evidence`, or
 *    `coverage_gap` — only the assertion layer can produce those (revision §8 #7).
 *  - `evidence_refs` lists `ScanFactRef[]` — AI cannot invent facts.
 */

import type { ContextRequest } from './context-request.js';
import type { BlastRadius } from './finding.js';
import type { ScanFactRef } from './scan-fact.js';

/**
 * Closed enum for `Hypothesis.proposed_finding_type`. Adding a value
 * here without updating predicate-consumer switches fails the build
 * via `assertExhaustiveProposedFindingType`.
 *
 * Note: `'confirmed_issue'`, `'missing_evidence'`, and `'coverage_gap'`
 * are **deliberately excluded** per revision §8 #7. The assertion layer
 * is the only producer of those classifications.
 */
export type ProposedFindingType = 'likely_issue' | 'informational';

export type HypothesisConfidence = 'low' | 'medium' | 'high';

/**
 * Stable reference to a `Hypothesis` by id. Used in
 * `Finding.supporting_hypothesis_refs` so the reporter can show "the AI
 * also saw this" without re-embedding the hypothesis text.
 */
export interface HypothesisRef {
  readonly hypothesis_id: string;
}

export interface Hypothesis {
  readonly hypothesis_id: string;
  /**
   * Closed for now; future inference sources can be added. Mirrors the
   * "AI is in three layers" framing — Phase 1 only has one inference
   * source.
   */
  readonly source: 'ai_inference';
  /**
   * Which canonical control this would map to if the predicate fires.
   * Free-form string for Phase 1 to match the existing `Finding.control_id`
   * convention; a future revision may brand `ControlId` everywhere in
   * one sweep.
   */
  readonly proposed_control_id?: string;
  readonly proposed_finding_type?: ProposedFindingType;
  readonly proposed_blast_radius?: BlastRadius;
  /**
   * Facts this hypothesis rests on. Required (at least one ref) at
   * runtime per revision §7.2; the type permits the empty array to
   * keep the AI Inference Agent's validator the single source of
   * truth for that rule.
   */
  readonly evidence_refs: readonly ScanFactRef[];
  readonly reasoning: string;
  readonly confidence: HypothesisConfidence;
  readonly uncertainty_notes: string;
  /**
   * When set, the hypothesis declares it needs more facts. The
   * `ContextPolicyEvaluator` either grants and produces new
   * `ScanFact[]` records, or denies (revision §5, §6.1).
   */
  readonly requires_context?: ContextRequest;
  readonly model_id: string;
  readonly prompt_fingerprint_sha256: string;
}

export function assertExhaustiveProposedFindingType(x: never): never {
  throw new Error(`Unhandled ProposedFindingType: ${JSON.stringify(x)}`);
}

export function assertExhaustiveHypothesisConfidence(x: never): never {
  throw new Error(`Unhandled HypothesisConfidence: ${JSON.stringify(x)}`);
}
