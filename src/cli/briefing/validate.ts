/**
 * Briefing AI-return validator (Phase 3 / Step 40d).
 *
 * The AI return is UNTRUSTED. It is validated three ways before any
 * field reaches a persisted briefing:
 *
 *  1. Zod schema match (closed shape, `.strict()` at every object level).
 *  2. Unknown-top-level-key rejection (retro-17c pattern).
 *  3. Recursive classification-key deny-walk via `containsClassificationKey`
 *     from `src/types/tool-result.ts` — the same belt-and-suspenders the
 *     loop uses for tool results (PLAN §D.1 / §D.2 extension for briefing).
 *
 * No `Finding` is constructed here. The briefing is metadata, never
 * evidence — the floor remains the sole `Finding` constructor (PLAN §D.2).
 */

import { z } from 'zod';

import { containsClassificationKey } from '../../types/tool-result.js';
import { err, ok, type Result } from '../../types/result.js';

import { BriefingSynthesisError } from './types.js';
import type {
  BriefingDependencySurface,
  BriefingListField,
  BriefingScalarField,
} from './types.js';

/** Subset of `ProjectBriefing` the AI authors (the rest is structural / runtime metadata). */
export interface AiAuthoredBriefingFields {
  readonly purpose: BriefingScalarField;
  readonly user_roles: BriefingListField;
  readonly data_kinds: BriefingListField;
  readonly auth_model: BriefingScalarField;
  readonly sensitive_tables: BriefingListField;
  readonly dependency_surface: BriefingDependencySurface;
  readonly observed_trust_boundaries: BriefingListField;
}

const confidenceSchema = z.enum(['low', 'medium', 'high']);

const scalarFieldSchema = z
  .strictObject({
    value: z.string(),
    confidence: confidenceSchema,
    uncertainty_notes: z.string().optional(),
  });

const listFieldSchema = z
  .strictObject({
    value: z.array(z.string()).readonly(),
    confidence: confidenceSchema,
    uncertainty_notes: z.string().optional(),
  });

const dependencySurfaceSchema = z
  .strictObject({
    framework: z.string(),
    key_deps: z.array(z.string()).readonly(),
    confidence: confidenceSchema,
    uncertainty_notes: z.string().optional(),
  });

const briefingAiReturnSchema = z
  .strictObject({
    purpose: scalarFieldSchema,
    user_roles: listFieldSchema,
    data_kinds: listFieldSchema,
    auth_model: scalarFieldSchema,
    sensitive_tables: listFieldSchema,
    dependency_surface: dependencySurfaceSchema,
    observed_trust_boundaries: listFieldSchema,
  });

/**
 * Validate the AI's structured return into the AI-authored briefing
 * fields. Rejects on Zod failure, on any classification key at any
 * depth, and on unknown top-level fields. Returns `Result.ok(partial)`
 * on success so the synthesizer can merge structural fields it already
 * computed.
 */
export function validateAiBriefingReturn(
  parsed: unknown,
): Result<AiAuthoredBriefingFields, BriefingSynthesisError> {
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return err(
      new BriefingSynthesisError(
        'briefing AI return was not a JSON object',
        'schema_violation',
      ),
    );
  }

  // Recursive deny-walk first — catches classification keys at any depth
  // before the Zod schema even runs. Belt-and-suspenders behind `.strict()`.
  if (containsClassificationKey(parsed)) {
    return err(
      new BriefingSynthesisError(
        'briefing AI return contained a classification key at some depth',
        'classification_key_smuggled',
      ),
    );
  }

  // V6 extension (codex 40D-CLASSIFICATION-STRINGS): also catch classification
  // tokens INSIDE scalar string values. `containsClassificationKey` checks
  // object keys + NamedFact `name` strings, not arbitrary string contents.
  if (briefingContainsClassificationStringToken(parsed)) {
    return err(
      new BriefingSynthesisError(
        'briefing AI return contained a classification-key token inside a scalar string value',
        'classification_key_smuggled',
      ),
    );
  }

  const result = briefingAiReturnSchema.safeParse(parsed);
  if (!result.success) {
    return err(
      new BriefingSynthesisError(
        `briefing AI return failed schema validation: ${result.error.message}`,
        'schema_violation',
      ),
    );
  }
  return ok(result.data as AiAuthoredBriefingFields);
}

/**
 * Tokens that MUST NOT appear inside any scalar string value of the
 * briefing. Includes the five classification keys (in case an AI tries
 * to smuggle one as part of a sentence) plus the five canonical
 * Finding-value tokens (`fix_before_launch` / `confirmed_issue` / …).
 *
 * Compared as a substring against every scalar string in the return.
 */
const CLASSIFICATION_STRING_TOKENS: readonly string[] = [
  'finding_type',
  'review_action',
  'evidence_strength',
  'blast_radius',
  'reproducibility',
  'fix_before_launch',
  'review_before_launch',
  'confirmed_issue',
  'likely_issue',
  'coverage_gap',
];

/**
 * Recursive walk of `value`; returns `true` if any string scalar (at
 * any depth) contains any of {@link CLASSIFICATION_STRING_TOKENS}.
 * Exported for the V6 standalone test.
 */
export function briefingContainsClassificationStringToken(value: unknown): boolean {
  if (typeof value === 'string') {
    for (const token of CLASSIFICATION_STRING_TOKENS) {
      if (value.includes(token)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => briefingContainsClassificationStringToken(item));
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (briefingContainsClassificationStringToken(nested)) return true;
    }
  }
  return false;
}
