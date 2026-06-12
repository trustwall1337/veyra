/**
 * Hypothesis-registry shapes (Phase 3 / Step 40e). The in-loop AI authors
 * `LoopHypothesis` entries via the propose-hypothesis / update-hypothesis
 * tools; the registry stores them in-process for the lifetime of one scan;
 * the loop projects `view.hypotheses` so every `proposeNext` sees prior
 * hypotheses.
 *
 * Hypotheses are read-only orchestration metadata, NOT evidence (PLAN §D.2).
 * The floor remains the sole `Finding` constructor (V8 import-graph guard).
 * The registry has no closed unions on app / control / provider names per
 * FPP §2A: `control_id_hint?` and `briefing_field_ref?` stay `string`.
 *
 * Decision A: fresh shape — the Phase-2 `src/types/hypothesis.ts` `Hypothesis`
 * is NOT reused (it carries `ScanFactRef[]` / `ProposedFindingType` baggage
 * that mixes verdict-shaped fields into AI metadata).
 */

import type { BriefingConfidence } from '../briefing/types.js';

/** Branded opaque ID; minted by the registry via monotonic counter. */
export type HypothesisId = string & { readonly __brand: 'HypothesisId' };

/**
 * Closed lifecycle vocabulary (Decision F). NO claim vocabulary (no
 * `confirmed` / `proven_*` / `launch_blocker`) — those are floor-only.
 */
export type HypothesisDisposition =
  | 'proposed'
  | 'partially_evidenced'
  | 'evidenced_against'
  | 'superseded';

/** Exhaustiveness helper — catches future disposition additions. */
export function assertExhaustiveHypothesisDisposition(d: never): never {
  throw new Error(`unhandled HypothesisDisposition: ${String(d)}`);
}

/**
 * One AI-authored hypothesis. The `statement` field is redacted prose;
 * `step_refs` cite loop-trace `seq` numbers (not `ScanFactRef`); see
 * Decision A.
 */
export interface LoopHypothesis {
  readonly hypothesis_id: HypothesisId;
  /** Redacted prose; minted via `Redactor` chokepoint before persist. */
  readonly statement: string;
  /** Open string per FPP §2A — never a closed union on control IDs. */
  readonly control_id_hint?: string;
  /** Open string per FPP §2A — names a ProjectBriefing field by name. */
  readonly briefing_field_ref?: string;
  readonly confidence: BriefingConfidence;
  readonly disposition: HypothesisDisposition;
  readonly proposed_at: string;
  /** Loop-trace `seq` numbers of accepted steps the AI cites as evidence. */
  readonly step_refs: readonly number[];
  /** When the AI revised a prior hypothesis into this one. */
  readonly supersedes_hypothesis_id?: HypothesisId;
  readonly model_id?: string;
  readonly prompt_fingerprint_sha256?: string;
}

/** Argument shape accepted by `HypothesisRegistry.propose(...)`. */
export interface ProposeHypothesisInput {
  readonly statement: string;
  readonly confidence: BriefingConfidence;
  readonly control_id_hint?: string;
  readonly briefing_field_ref?: string;
  readonly step_refs?: readonly number[];
  readonly supersedes_hypothesis_id?: HypothesisId;
  readonly model_id?: string;
  readonly prompt_fingerprint_sha256?: string;
}

/** Patch shape accepted by `HypothesisRegistry.update(...)`. */
export interface UpdateHypothesisPatch {
  readonly disposition?: HypothesisDisposition;
  readonly step_refs?: readonly number[];
  readonly statement_addendum?: string;
}

// ── Error classes ───────────────────────────────────────────────────────
//
// These all extend `ToolInvocationError` so the loop's `recordToolError`
// path preserves the specific error CLASS name in the trace row's
// `tool_error_class` field (the loop reads `invokeResult.error.name`).
// codex 40e-diff-002 [APPLIED]: makes the prewrite-reject audit class
// testable end-to-end.

import { ToolInvocationError } from '../../core/tools/descriptor.js';

export class ClassificationKeyInArgsError extends ToolInvocationError {
  override readonly name = 'ClassificationKeyInArgsError';
}

export class ClaimVocabularyInArgsError extends ToolInvocationError {
  override readonly name = 'ClaimVocabularyInArgsError';
}

export class UnknownHypothesisError extends ToolInvocationError {
  override readonly name = 'UnknownHypothesisError';
}

export class UnknownStepRefError extends ToolInvocationError {
  override readonly name = 'UnknownStepRefError';
}

export class EmptyStepRefsForEvidenceDispositionError extends ToolInvocationError {
  override readonly name = 'EmptyStepRefsForEvidenceDispositionError';
}
