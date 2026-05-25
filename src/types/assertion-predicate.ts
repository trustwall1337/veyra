/**
 * `AssertionPredicate` — the signature every deterministic baseline
 * control must satisfy.
 *
 * Per AI-shape revision §4.1:
 *
 *   "Each baseline predicate is a pure function
 *    `(ScanFact[], DeclaredContext) → Finding | null`. It does NOT take
 *    hypotheses as input. Hypotheses can corroborate or add
 *    `uncertainty_notes` to a finding, but the predicate's verdict
 *    comes from facts."
 *
 * Two structural rules are enforced at the type level:
 *
 *  1. The signature is fact-only. `Hypothesis[]` is not a parameter.
 *     AI-presence cannot promote a baseline finding; AI-absence cannot
 *     suppress one (revision §8 #10).
 *  2. The return type is `Finding | null`, never `Hypothesis | null` or
 *     `AIConcern | null`. Only the assertion layer produces findings
 *     (revision §8 #7).
 */

import type { Finding } from './finding.js';
import type { ScanFact } from './scan-fact.js';

/**
 * Minimal forward-declared shape for `DeclaredContext`. The actual
 * composer + field-ownership rules live with the AI Product-
 * Understanding step (revision §7.1). This shape lets predicates type
 * their arguments today; a later revision step refines it without
 * breaking existing predicates.
 *
 *  - `observed_evidence` — populated by the deterministic Bootstrap
 *    Inventory only. AI is rejected here per revision §8 #8.
 *  - `declared_intent` — populated by the AI Product-Understanding
 *    Agent (or by Lovable `send_message` raw responses in `--no-ai`).
 *  - `sources` — audit trail; both source artifacts' fingerprints land
 *    here.
 *
 * **Forward-compat rule:** any later refinement of this shape MUST be
 * additive (field-widening). Narrowing `Record<string, unknown>` into
 * a concrete shape is allowed; renaming or removing the three fields
 * above would break every existing predicate signature.
 */
export interface DeclaredContext {
  readonly observed_evidence: Readonly<Record<string, unknown>>;
  readonly declared_intent: Readonly<Record<string, unknown>>;
  readonly sources: readonly string[];
}

export type AssertionPredicate = (
  facts: readonly ScanFact[],
  declaredContext: DeclaredContext,
) => Finding | null;
