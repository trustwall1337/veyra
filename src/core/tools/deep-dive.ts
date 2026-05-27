import { z } from 'zod';

import type { AllowedAction } from '../../types/validation-policy.js';

/**
 * Bounded deep-dive sub-agent type substrate (Phase 3 / Agentic Veyra,
 * `PLAN.md §O` + `decisions.md` D6, ratified 2026-05-27). Type + schema surface
 * ONLY: this file declares the shapes the loop driver and spawn gate use. It
 * does NOT implement spawning, depth-cap enforcement, sub-scope derivation,
 * budget debit, scheduling, nested audit, or failure isolation — those are
 * runtime concerns owned by Step 31 (depth-aware `runDeepDive`) and Step 31c
 * (`authorizeSpawn` + `deriveSubScope`). The D6 runtime constraints those steps
 * MUST enforce (depth cap 1, strict-subset-of-parent scope, budget no-escape,
 * same gate + result-parse-or-reject spine, facts-only, nested audit, failure
 * isolation → `subagent_error` + §K `coverage_gap`) are specified in `§O`.
 *
 * Layering (codex / `§O`): kept provider-agnostic in `src/core` — actions +
 * opaque refs, no provider-specific concrete schema — so
 * `no-cross-layer-imports.test.ts` stays green. Any provider-specific target
 * shape lives in a leaf folder, not here.
 */

/**
 * The kinds of deep-dive a sub-agent may run; the discriminant of
 * {@link TargetDescriptor} and the key of {@link DEEP_DIVE_SCOPE_TABLE}. A
 * domain taxonomy (like `AllowedAction`), NOT a provider/service id — so a
 * closed union is allowed here (FPP §2A forbids closed unions of *services*).
 * Adding a kind is a deliberate edit: it forces a new scope-table row
 * (compile-time, via `Record`) AND trips the pinned
 * {@link DEEP_DIVE_SCOPE_ROW_COUNT} test.
 */
export type TargetKind = 'rls_policy_graph' | 'suspected_idor';

/**
 * Opaque, branded reference to a subject already present in loop state (e.g. a
 * table or endpoint named by a prior fact). This is the "no free text"
 * alternative the `§O` layering note requires: a sub-agent target is an opaque
 * REFERENCE, never AI-authored prose. The loop validates the ref resolves to a
 * real prior fact at spawn time (Step 31 / 31c); core keeps it opaque.
 */
export type SubjectRef = z.infer<typeof subjectRefSchema>;

const subjectRefSchema = z.string().min(1).brand<'SubjectRef'>();

/**
 * Closed, `.strict()`, discriminated-by-`kind` schema for a single deep-dive
 * target. The loop `safeParse`s `proposal.target_descriptor` against this
 * before spawning (`§O`); an extra key, an unknown kind, or a missing subject
 * is rejected → the loop records an arg-reject and continues. No free-text
 * field exists.
 */
export const targetDescriptorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rls_policy_graph'),
    subject: subjectRefSchema,
  }),
  z.strictObject({
    kind: z.literal('suspected_idor'),
    subject: subjectRefSchema,
  }),
]);

/**
 * Provider-agnostic descriptor of ONE deep-dive target — the inferred type of
 * {@link targetDescriptorSchema}. A closed discriminated union: each arm is the
 * `kind` discriminant plus an opaque {@link SubjectRef}; the action scope is
 * looked up deterministically from {@link DEEP_DIVE_SCOPE_TABLE}, never chosen
 * by the AI.
 */
export type TargetDescriptor = z.infer<typeof targetDescriptorSchema>;

/** The deterministic, table-derived scope of one deep-dive target kind. */
export interface DeepDiveScope {
  /** Human-readable description of what this deep-dive may examine. */
  readonly summary: string;
  /**
   * The narrow subset of policy actions a sub-agent on this target may use
   * (actions, NOT tool ids — kept provider-agnostic). `deriveSubScope`
   * (Step 31c) filters the parent catalog to descriptors whose
   * `required_action` is in this list, then asserts the result is a STRICT
   * subset of the parent's scope. The AI cannot widen scope beyond the table.
   */
  readonly allowed_actions: readonly AllowedAction[];
}

/**
 * Checked-in literal scope table, keyed by {@link TargetKind} (mirrors the §K
 * required-evidence-ledger discipline). `Record<TargetKind, …>` makes every
 * kind carry a row at compile time; the pinned {@link DEEP_DIVE_SCOPE_ROW_COUNT}
 * makes adding a row a deliberate, CI-visible change. NOT derived from any
 * catalog.
 */
export const DEEP_DIVE_SCOPE_TABLE: Readonly<
  Record<TargetKind, DeepDiveScope>
> = {
  rls_policy_graph: {
    summary:
      "Deep-dive one table's RLS policy graph using read-only schema and storage metadata.",
    allowed_actions: ['read_schema_metadata', 'read_storage_metadata'],
  },
  suspected_idor: {
    summary:
      'Deep-dive one suspected IDOR: exercise one resource with a test identity and verify denial.',
    allowed_actions: ['call_api_with_test_identity', 'verify_denial'],
  },
};

/**
 * CI-pinned row count for {@link DEEP_DIVE_SCOPE_TABLE}. A test asserts
 * `Object.keys(DEEP_DIVE_SCOPE_TABLE).length === DEEP_DIVE_SCOPE_ROW_COUNT` so a
 * silent change (e.g. a derive-from-catalog regression) trips CI.
 */
export const DEEP_DIVE_SCOPE_ROW_COUNT = 2;

/** Resolve a target's deterministic action scope from the table. */
export function scopeForTarget(target: TargetDescriptor): DeepDiveScope {
  return DEEP_DIVE_SCOPE_TABLE[target.kind];
}

/**
 * The `spawn_deep_dive` arm of the AI driver's proposal union, alongside the
 * `invoke_tool` and `done` arms (`§O`). Step 30 lands only this arm type so
 * downstream code can name it; Step 31 folds it into the full proposal union
 * and adds the budget `requested_slice` it consumes at spawn time.
 */
export interface SpawnDeepDiveProposal {
  readonly kind: 'spawn_deep_dive';
  readonly target_descriptor: TargetDescriptor;
}
