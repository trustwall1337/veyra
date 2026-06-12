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
  //
  // Step 39b codex 39b-probe-args-structured-fields-broken [APPLIED]:
  //  - the materialised value is the TRANSFORM OUTPUT of the schema; for
  //    cc-11-13c/d/e this is a pre-built PostgREST query fragment that is
  //    already URL-safe — the compiler MUST NOT re-encode it.
  //  - identifier-only inputs (cc-11-3 id, cc-11-6 table, etc.) are
  //    constrained to a regex that bans URL-fragment characters; encoding
  //    them would be a no-op too.
  //  - reject unknown keys in `proposed.path_params` that aren't declared
  //    by the primitive's pathParams.
  const declaredKeys = new Set(Object.keys(primitive.requestSchema.pathParams));
  for (const key of Object.keys(proposed.path_params)) {
    if (!declaredKeys.has(key)) {
      return {
        ok: false,
        reason: `path param "${key}" is not declared by this probe primitive`,
      };
    }
  }

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
    // Materialised value is the schema's transform output (or the raw value
    // if no transform). String-coerce defensively; identifier-only schemas
    // produce strings, structured schemas produce URL-safe fragments via
    // their `.transform(...)` chain.
    materialisedParams[name] = String(parsed.data);
  }

  // Body shape (injection / pollution guard — Verification c).
  const body = primitive.requestSchema.bodySchema.safeParse(proposed.body);
  if (!body.success) {
    return { ok: false, reason: 'body failed schema' };
  }

  // Materialise URL: substitute `{name}` placeholders.
  // codex 39b-probe-args-structured-fields-broken [APPLIED]: do NOT call
  // encodeURIComponent on materialised values. Identifier inputs are
  // already URL-safe (regex enforces); structured inputs have already
  // produced URL-safe transform output (encodeURIComponent on values
  // inside the transform, literal `=` / `,` / `/` operators preserved).
  const url = primitive.requestSchema.urlTemplate.value.replace(
    /\{([a-z_][a-zA-Z0-9_]*)\}/g,
    (_match, key: string) => {
      const value = materialisedParams[key];
      return value !== undefined ? value : `{${key}}`;
    },
  );

  return { ok: true, method: fixedMethod, url, body: body.data };
}
