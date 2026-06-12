/**
 * In-process hypothesis registry (Phase 3 / Step 40e).
 *
 * Closure-only, instance-per-scan (40c-v3 `ActorSecretRegistry` pattern).
 * IDs are minted via a per-instance monotonic counter (`hyp_000001`, ...)
 * for V1 byte-identical recorded-fixture determinism (Decision I per
 * codex 40e-random-hypothesis-id-breaks-recorded-determinism [APPLIED]).
 *
 * The registry never imports `Finding` / `ScanFact` / agent predicates
 * (V8 import-graph guard).
 */

import { type Result, err, ok } from '../../types/result.js';

import {
  type HypothesisDisposition,
  type HypothesisId,
  type LoopHypothesis,
  type ProposeHypothesisInput,
  type UpdateHypothesisPatch,
  UnknownHypothesisError,
} from './types.js';

export interface HypothesisRegistryOptions {
  /** Injected wall-clock; tests pin a fixed time for V1 normalisation. */
  readonly now: () => number;
}

/** In-process registry. Mutates in place; serializable via `snapshot()`. */
export class HypothesisRegistry {
  private readonly entries: LoopHypothesis[] = [];
  private readonly byId = new Map<string, number>();
  private counter = 0;

  constructor(private readonly options: HypothesisRegistryOptions) {}

  private mintId(): HypothesisId {
    this.counter += 1;
    const padded = this.counter.toString().padStart(6, '0');
    return `hyp_${padded}` as HypothesisId;
  }

  /**
   * Append a new hypothesis. Caller (the propose-hypothesis tool) has
   * already run the prewrite guards on `args` — this method only
   * mutates state; it does NOT re-walk for classification keys.
   */
  propose(
    input: ProposeHypothesisInput,
  ): Result<LoopHypothesis, never> {
    const id = this.mintId();
    const proposed_at = new Date(this.options.now()).toISOString();
    const entry: LoopHypothesis = {
      hypothesis_id: id,
      statement: input.statement,
      confidence: input.confidence,
      disposition: 'proposed',
      proposed_at,
      step_refs: input.step_refs ?? [],
      ...(input.control_id_hint !== undefined
        ? { control_id_hint: input.control_id_hint }
        : {}),
      ...(input.briefing_field_ref !== undefined
        ? { briefing_field_ref: input.briefing_field_ref }
        : {}),
      ...(input.supersedes_hypothesis_id !== undefined
        ? { supersedes_hypothesis_id: input.supersedes_hypothesis_id }
        : {}),
      ...(input.model_id !== undefined ? { model_id: input.model_id } : {}),
      ...(input.prompt_fingerprint_sha256 !== undefined
        ? { prompt_fingerprint_sha256: input.prompt_fingerprint_sha256 }
        : {}),
    };
    this.entries.push(entry);
    this.byId.set(id, this.entries.length - 1);
    return ok(entry);
  }

  /**
   * Update an existing hypothesis. Rejects unknown IDs. The caller (the
   * update-hypothesis tool) is responsible for running step-ref grounding
   * (Decision M) BEFORE invoking this method.
   */
  update(
    hypothesis_id: HypothesisId,
    patch: UpdateHypothesisPatch,
  ): Result<LoopHypothesis, UnknownHypothesisError> {
    const idx = this.byId.get(hypothesis_id);
    if (idx === undefined) {
      return err(
        new UnknownHypothesisError(
          `unknown hypothesis_id "${String(hypothesis_id)}"`,
        ),
      );
    }
    const prev = this.entries[idx];
    if (prev === undefined) {
      return err(
        new UnknownHypothesisError(
          `registry index ${String(idx)} for ${String(hypothesis_id)} missing`,
        ),
      );
    }
    // Compose the next statement by appending the addendum (if any).
    const nextStatement =
      patch.statement_addendum !== undefined && patch.statement_addendum.length > 0
        ? `${prev.statement}\n[update] ${patch.statement_addendum}`
        : prev.statement;
    const next: LoopHypothesis = {
      ...prev,
      statement: nextStatement,
      ...(patch.disposition !== undefined ? { disposition: patch.disposition } : {}),
      ...(patch.step_refs !== undefined ? { step_refs: patch.step_refs } : {}),
    };
    this.entries[idx] = next;
    return ok(next);
  }

  /** Read-only chronological snapshot (oldest first). */
  snapshot(): readonly LoopHypothesis[] {
    return this.entries.slice();
  }

  /** Lookup by id (registry's own fast path; view is array-shaped). */
  get(hypothesis_id: HypothesisId): LoopHypothesis | undefined {
    const idx = this.byId.get(hypothesis_id);
    if (idx === undefined) return undefined;
    return this.entries[idx];
  }

  /** Count entries by disposition — used by the report footer. */
  countByDisposition(): Readonly<Record<HypothesisDisposition, number>> {
    const out: Record<HypothesisDisposition, number> = {
      proposed: 0,
      partially_evidenced: 0,
      evidenced_against: 0,
      superseded: 0,
    };
    for (const e of this.entries) out[e.disposition] += 1;
    return out;
  }

  /** Wipe on success AND on crash (40c-v3 ActorSecretRegistry pattern). */
  clear(): void {
    this.entries.length = 0;
    this.byId.clear();
    this.counter = 0;
  }
}
