import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

import { detectPrivateColumnLeak } from './body-predicates.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * cc-11-13b — `select=*` surfaces declared-private columns. The body
 * predicate (in body-predicates.ts) inspects the response for any column
 * named in `privateColumns`.
 *
 * V9c bounded array (codex 39b-url-schema-dynamic-keys [APPLIED]):
 * privateColumns is min(1).max(8) identifier-only.
 */
export const CC_11_13B: ProbePrimitive = {
  id: 'cc-11-13b-select-star-private-cols',
  control_id: 'cc-11-13b',
  title: 'select=* surfaces declared-private columns',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/rest/v1/{table}?select=*' },
    pathParams: {
      table: {
        mode: 'ai_authored',
        schema: z.string().regex(PG_IDENTIFIER_REGEX),
      },
      privateColumns: {
        mode: 'ai_authored',
        schema: z
          .array(z.string().regex(PG_IDENTIFIER_REGEX))
          .min(1)
          .max(8)
          .transform((cols) => cols.join(',')),
      },
    },
    bodySchema: z.undefined(),
  },
  // 39b codex 39b-cleanup-strategy-not-enforced [APPLIED]: observational
  // GET — body-predicate inspects response for declared-private columns;
  // no row creation by the probe itself, so cleanup_strategy is
  // audit_only and the create/cleanup actions are dropped from
  // requiredActions. Fixture rows are out-of-band (synthetic-data
  // manager / pre-existing test data).
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
  // codex 39b-outcome-config-not-wired [APPLIED]: per-control body-predicate.
  // Reads `args.privateColumns` (validated as readonly string[] by the
  // pathParams schema's pre-transform input) to check for those keys
  // surfacing in the response.
  bodyPredicate: (body, args) => {
    const cols = args['privateColumns'];
    const list = Array.isArray(cols) ? cols.filter((c): c is string => typeof c === 'string') : [];
    return detectPrivateColumnLeak(body, list);
  },
};
