import { z } from 'zod';

import type { ProbePrimitive } from '../../types/probe-primitive.js';

/**
 * Runtime probe-primitive catalog (Phase 3 / Step 40c).
 *
 * Lifts the cc-11-3 IDOR primitive from the test declaration at
 * `probe-primitives.test.ts:21-36` into an exported runtime catalog. The
 * Mode B Bedrock loop's `probe-http` descriptor (`src/scanners/probe-http/`)
 * looks up `args.probe_id` here and runs the corresponding primitive against
 * the operator's Supabase sandbox PostgREST surface.
 *
 * Adding a new primitive is one new entry in `PROBE_PRIMITIVE_CATALOG` (the
 * §17 Step-40c scale-out test asserts a `Map.set` line is sufficient — no
 * `switch (probe_id)` in any consumer).
 *
 * Step 39b is the deferred follow-up that migrates the other 12
 * `CatalogEntry`s under `src/agents/sandbox-runner/test-catalog/` into this
 * runtime catalog. Today only `cc-11-3` ships.
 */

/**
 * cc-11-3 IDOR — direct object access at /api/orders/{id} with a non-owning
 * identity. The `id` placeholder is AI-authored within schema (non-empty
 * string, length ≤ 64, alphanumeric + dash only). Method + URL template are
 * fixed (preventer 9 — AI does not invent the test type).
 */
const IDOR_PROBE: ProbePrimitive = {
  id: 'cc-11-3-direct-object-access',
  control_id: 'cc-11-3',
  title: 'Direct object access via /api/orders/{id}',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/api/orders/{id}' },
    pathParams: {
      id: {
        mode: 'ai_authored',
        schema: z.string().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/),
      },
    },
    bodySchema: z.undefined(),
  },
};

/**
 * The runtime catalog. Keyed by `primitive.id`; the `probe-http` tool calls
 * `PROBE_PRIMITIVE_CATALOG.get(args.probe_id)` and rejects unknown ids.
 */
export const PROBE_PRIMITIVE_CATALOG: ReadonlyMap<string, ProbePrimitive> =
  new Map<string, ProbePrimitive>([[IDOR_PROBE.id, IDOR_PROBE]]);

/** Convenience accessor — returns `undefined` for unknown probe ids. */
export function getProbePrimitive(id: string): ProbePrimitive | undefined {
  return PROBE_PRIMITIVE_CATALOG.get(id);
}
