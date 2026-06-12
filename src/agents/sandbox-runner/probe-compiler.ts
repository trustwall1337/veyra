import type {
  CompiledProbeRequest,
  ProbePrimitive,
  ProposedProbeRequest,
} from '../../types/probe-primitive.js';

/**
 * Probe request compiler (Phase 3 / Step 39). Validates an AI-proposed request
 * against the probe primitive's {@link ProbePrimitive.requestSchema}; on
 * success, materialises the final method/URL/body. On failure, returns a
 * structured reason the loop records as `arg_reject` (Verification c).
 *
 *  - `fixed` fields the AI tried to modify → rejected.
 *  - `ai_authored` fields not matching their `schema` → rejected (Verification b/d).
 *  - the body must safe-parse against `bodySchema` (Verification c, injection guard).
 *  - the materialised URL substitutes `{placeholder}` for AI-authored values.
 */
export function compileProbeRequest(
  primitive: ProbePrimitive,
  proposed: ProposedProbeRequest,
): CompiledProbeRequest {
  // Method must equal the fixed value (Verification b — AI cannot author `fixed`).
  const fixedMethod = primitive.requestSchema.method.value;
  if (proposed.method !== fixedMethod) {
    return {
      ok: false,
      reason: `method is fixed to ${fixedMethod}; AI proposed ${String(proposed.method)}`,
    };
  }

  // Validate each AI-authored path-param against its declared schema; fail
  // closed if a fixed-only placeholder was supplied with a different value
  // OR an authored placeholder is missing / malformed.
  const materialisedParams: Record<string, string> = {};
  for (const [name, field] of Object.entries(primitive.requestSchema.pathParams)) {
    const supplied = proposed.path_params[name];
    if (field.mode === 'fixed') {
      if (supplied !== undefined && supplied !== field.value) {
        return {
          ok: false,
          reason: `path param ${name} is fixed; AI must not override it`,
        };
      }
      materialisedParams[name] = field.value;
      continue;
    }
    // ai_authored
    if (supplied === undefined) {
      return { ok: false, reason: `path param ${name} (ai_authored) missing` };
    }
    const parsed = field.schema.safeParse(supplied);
    if (!parsed.success) {
      return {
        ok: false,
        reason: `path param ${name} failed schema`,
      };
    }
    materialisedParams[name] = String(parsed.data);
  }

  // Body shape (injection / pollution guard — Verification c).
  const body = primitive.requestSchema.bodySchema.safeParse(proposed.body);
  if (!body.success) {
    return { ok: false, reason: 'body failed schema' };
  }

  // Materialise URL: substitute `{name}` placeholders.
  const url = primitive.requestSchema.urlTemplate.value.replace(
    /\{([a-z_][a-z0-9_]*)\}/g,
    (_match, key: string) => {
      const value = materialisedParams[key];
      return value !== undefined ? encodeURIComponent(value) : `{${key}}`;
    },
  );

  return { ok: true, method: fixedMethod, url, body: body.data };
}
