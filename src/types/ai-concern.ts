/**
 * `AIConcern` — the audit record for an AI Hypothesis that the
 * deterministic assertion layer did NOT promote to a Finding.
 *
 * Per AI-shape revision §3.4:
 *
 *  - Producer: Assertion Layer (Pass 2 disposition; revision §4.2).
 *  - Consumers: Reporter (renders under "AI-suggested areas for human
 *    review"; never mixed with Findings).
 *  - Lives in this file; written to the `ai_concerns` artifact.
 *
 * Trust-model constraints embedded in the type:
 *
 *  - `category` is closed to `'no_predicate_fired' | 'insufficient_facts'`.
 *    `'predicate_contradicted'` is **deliberately excluded** per revision
 *    §4.2 rule 2 — contradicted hypotheses go to `assertions.json` only,
 *    audit-only, never to the user-visible `AIConcern` stream.
 *  - `evidence_refs` lists `ScanFactRef[]` — concerns rest on facts,
 *    not on free-floating AI assertions.
 */

import type { HypothesisConfidence } from './hypothesis.js';
import type { ScanFactRef } from './scan-fact.js';

export type AIConcernCategory =
  | 'no_predicate_fired'
  | 'insufficient_facts';

export interface AIConcern {
  readonly concern_id: string;
  readonly originating_hypothesis_id: string;
  readonly category: AIConcernCategory;
  /** Copied verbatim from the originating hypothesis's `reasoning` field. */
  readonly reasoning: string;
  readonly confidence: HypothesisConfidence;
  readonly evidence_refs: readonly ScanFactRef[];
  readonly uncertainty_notes: string;
  /** Plain-language hint to the reviewer about what to manually check. */
  readonly suggested_human_review: string;
  readonly model_id: string;
}

export function assertExhaustiveAIConcernCategory(x: never): never {
  throw new Error(`Unhandled AIConcernCategory: ${JSON.stringify(x)}`);
}
