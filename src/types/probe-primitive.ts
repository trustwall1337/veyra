import type { z } from 'zod';

/**
 * Probe-primitive request-schema substrate (Phase 3 / Step 39, Directive 1).
 * Each active probe declares the SHAPE of the request it will issue and
 * declares which fields the AI may parameterise vs which are FIXED. The
 * agentic loop validates the AI-proposed request against this schema BEFORE
 * the probe runs; a deterministic outcome classifier (in the floor — Step 35)
 * decides the assertion outcome AFTER. AI never invents a new executable test
 * type (preventer 9 spirit); AI authors parameters within a typed envelope.
 */

/** A probe field the AI may author. */
export interface AiAuthoredField {
  readonly mode: 'ai_authored';
  /** Zod schema constraining the field value (length cap, regex, etc.). */
  readonly schema: z.ZodTypeAny;
}

/** A probe field whose value is fixed in the probe primitive. */
export interface FixedField<T> {
  readonly mode: 'fixed';
  readonly value: T;
}

export type ProbeField<T> = AiAuthoredField | FixedField<T>;

/**
 * The request shape a probe will issue. `method` is typically fixed; `urlTemplate`
 * is fixed with `{name}` placeholders the AI may fill (each placeholder is one
 * `aiAuthored` field below); `bodySchema` is a Zod schema bounding the body
 * (rejects injection/pollution + caps per-field length).
 */
export interface ProbeRequestSchema {
  readonly method: FixedField<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  readonly urlTemplate: FixedField<string>;
  /** Map of `{placeholder} → field`. AI authors authored values; fixed values are checked. */
  readonly pathParams: Readonly<Record<string, ProbeField<string>>>;
  readonly bodySchema: z.ZodTypeAny;
}

/** One executable probe primitive. */
export interface ProbePrimitive {
  /** Stable id of the probe (e.g. `cc-11-3-direct-object-access`). */
  readonly id: string;
  /** Control id the probe contributes evidence for. */
  readonly control_id: string;
  /** Short human description (allowed-claim wording). */
  readonly title: string;
  /** Declared request shape (Verification a). */
  readonly requestSchema: ProbeRequestSchema;
}

/** An AI-authored proposed request, validated against {@link ProbeRequestSchema}. */
export interface ProposedProbeRequest {
  readonly method: string;
  readonly path_params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** Result of compiling an AI-proposed request against a probe primitive. */
export type CompiledProbeRequest =
  | {
      readonly ok: true;
      readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      readonly url: string;
      readonly body: unknown;
    }
  | { readonly ok: false; readonly reason: string };
