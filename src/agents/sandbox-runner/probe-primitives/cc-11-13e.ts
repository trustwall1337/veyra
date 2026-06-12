import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
const FILTER_VALUE_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * cc-11-13e — private-column filter: AI authors `column=eq.value` to
 * search rows by a declared-private column. The URL builder constructs
 * the query string from a STRUCTURED filter — AI does NOT author raw
 * query syntax.
 *
 * Decision L: empty response is inconclusive — RLS-filter vs no-match
 * indistinguishable from outside; no side-channel reasoning.
 */
export const CC_11_13E: ProbePrimitive = {
  id: 'cc-11-13e-private-column-filter',
  control_id: 'cc-11-13e',
  title: 'Private-column filter via PostgREST column=eq.value',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/rest/v1/{table}?{filter}' },
    pathParams: {
      table: {
        mode: 'ai_authored',
        schema: z.string().regex(PG_IDENTIFIER_REGEX),
      },
      filter: {
        mode: 'ai_authored',
        schema: z
          .strictObject({
            column: z.string().regex(PG_IDENTIFIER_REGEX),
            value: z.string().regex(FILTER_VALUE_REGEX),
          })
          .transform((f) => `${f.column}=eq.${encodeURIComponent(f.value)}`),
      },
    },
    bodySchema: z.undefined(),
  },
  // 39b codex 39b-cleanup-strategy-not-enforced [APPLIED]: observational GET
  // — no row creation by the probe itself.
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
  uncertainty_notes:
    'empty response is inconclusive; RLS-filter vs no-match indistinguishable from outside (no side-channel reasoning)',
};
