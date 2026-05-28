import { z } from 'zod';

/**
 * The in-loop tool-result substrate (Phase 3 / Agentic Veyra, PLAN §C, §D.2).
 *
 * A tool returns *facts* — plain observations. It may NEVER return a
 * classification verdict. The five forbidden keys below are exactly the
 * discriminators a {@link import('./finding.js').Finding} carries. The ban is
 * enforced two ways, matching the codex trust-model requirement that "a tool
 * literally cannot return a Finding-shaped object":
 *
 *  - **Compile time (top level):** {@link ToolResult} is a closed shape whose
 *    only field is `facts`, so an object literal carrying a classification key
 *    fails excess-property checking. {@link WithoutClassificationKeys} is the
 *    explicit `Exclude`-based guard.
 *  - **Runtime (any depth):** the whitelist {@link NamedFact} payload makes a
 *    classification *key* un-representable even nested, `.strict()` rejects
 *    unknown keys, and {@link containsClassificationKey} is the
 *    belt-and-suspenders recursive deny-walk (PLAN §C keeps the deny-list out
 *    of the type contract so it cannot silently rot).
 *
 * The deterministic post-loop floor (Step 35) is the SOLE producer of
 * classified Findings. Nothing here classifies.
 */

/**
 * The classification keys a Finding carries (see `finding.ts`). A tool result
 * may never carry any of these. Kept in sync with `Finding` by the
 * `tool-result.test.ts` assertion that pins this list.
 */
export const CLASSIFICATION_KEYS = [
  'finding_type',
  'review_action',
  'evidence_strength',
  'blast_radius',
  'reproducibility',
] as const;

/** Union of the forbidden classification keys. */
export type ClassificationKey = (typeof CLASSIFICATION_KEYS)[number];

const CLASSIFICATION_KEY_SET: ReadonlySet<string> = new Set(CLASSIFICATION_KEYS);

/** A leaf fact value. */
export type FactScalar = string | number | boolean | null;

/**
 * A fact value: a scalar, a list of fact values, or a list of named facts.
 * There is deliberately NO open `{ [k: string]: ... }` record in this union —
 * structured data is expressed as a list of {@link NamedFact}, so an arbitrary
 * key such as `finding_type` is un-representable at any depth (the whitelist
 * contract from PLAN §C).
 */
export type FactValue = FactScalar | readonly FactValue[] | readonly NamedFact[];

/** A single named observation. Fixed keys only — no open record. */
export interface NamedFact {
  readonly name: string;
  readonly value: FactValue;
}

/**
 * The in-loop tool-result base. Closed shape: the only field is `facts`, so a
 * classification key at the top level is a compile error (excess property).
 */
export interface ToolResult {
  readonly facts: readonly NamedFact[];
}

/**
 * Compile-time guard: resolves to `T` if `T` carries no classification key,
 * and to `never` otherwise. Use it to assert a candidate result type is
 * classification-free at the type level.
 */
export type WithoutClassificationKeys<T> =
  Extract<keyof T, ClassificationKey> extends never ? T : never;

/**
 * Recursive runtime deny-walk: returns `true` if any object key in `value`
 * (at ANY nesting depth, including inside arrays) is a classification key.
 * Belt-and-suspenders behind the whitelist schema — PLAN §C, §D.2(ii).
 */
export function containsClassificationKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsClassificationKey(item));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(obj)) {
      if (CLASSIFICATION_KEY_SET.has(key)) return true;
      if (containsClassificationKey(nested)) return true;
    }
    // codex p3-r1-004: a NamedFact-shaped object can smuggle a classification
    // discriminator via its `name` value (e.g. `{name:'finding_type', value:'x'}`)
    // even though `name` and `value` are not classification keys themselves.
    // Reject when `name` is a string matching the classification key set.
    if (typeof obj['name'] === 'string' && CLASSIFICATION_KEY_SET.has(obj['name'])) {
      return true;
    }
  }
  return false;
}

const factScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

// Recursive whitelist. `z.lazy` defers evaluation so the mutual reference
// resolves only at parse time, never at module-eval time.
const factValueSchema: z.ZodType<FactValue> = z.lazy(() =>
  z.union([
    factScalarSchema,
    z.array(factValueSchema),
    z.array(namedFactSchema),
  ]),
);

const namedFactSchema: z.ZodType<NamedFact> = z.lazy(() =>
  z.strictObject({
    // codex p3-r1-004 belt-and-suspenders: reject when `name` is a
    // classification key string, so a fact named `finding_type` cannot smuggle
    // a verdict through the loop boundary even though `name` is not itself a
    // classification key.
    name: z
      .string()
      .refine(
        (n) => !CLASSIFICATION_KEY_SET.has(n),
        { message: 'NamedFact.name must not be a classification key' },
      ),
    value: factValueSchema,
  }),
);

/**
 * Base schema every concrete tool's `result_schema` composes (Step 33). It is
 * `.strict()` at every object level (whitelist), and refuses any classification
 * key at any depth via {@link containsClassificationKey}. A malformed or
 * poisoned result fails `safeParse` → the loop records a `tool_result_reject`
 * and never persists it (PLAN §D.1).
 */
export const toolResultBaseSchema = z
  .strictObject({
    facts: z.array(namedFactSchema),
  })
  .refine((value) => !containsClassificationKey(value), {
    message:
      'tool result must not carry a classification key (finding_type/review_action/evidence_strength/blast_radius/reproducibility) at any depth',
  });

/**
 * The base schema typed as `ZodType<ToolResult>` so a concrete tool's
 * `result_schema` (Step 33) composes it without a per-site cast. The single
 * `as unknown as` here is the contained cost of `.refine()` widening the
 * inferred type away from the `ToolResult` interface; behaviour is identical to
 * {@link toolResultBaseSchema}. (Resolves the step-30 review note that deferred
 * a typed helper to Step 33.)
 */
export const toolResultSchema: z.ZodType<ToolResult> =
  toolResultBaseSchema as unknown as z.ZodType<ToolResult>;
