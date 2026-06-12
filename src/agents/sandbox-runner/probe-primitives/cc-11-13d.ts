import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * cc-11-13d — foreign-table embed leak: PostgREST embed surfaces
 * cross-tenant rows via a related-table lookup (e.g.
 * `select=id,profile(secret_col)`). The URL builder constructs the
 * `select=` clause from STRUCTURED columns — AI does NOT author raw
 * embed syntax.
 *
 * V9c bounded arrays (codex 39b-url-schema-dynamic-keys [APPLIED]):
 * parentColumns + foreignColumns are min(1).max(8) identifier-only.
 */
export const CC_11_13D: ProbePrimitive = {
  id: 'cc-11-13d-foreign-table-embed-leak',
  control_id: 'cc-11-13d',
  title: 'PostgREST embed surfaces cross-tenant rows via foreign-table lookup',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/rest/v1/{table}?select={embed}' },
    pathParams: {
      table: {
        mode: 'ai_authored',
        schema: z.string().regex(PG_IDENTIFIER_REGEX),
      },
      embed: {
        mode: 'ai_authored',
        schema: z
          .strictObject({
            parentColumns: z.array(z.string().regex(PG_IDENTIFIER_REGEX)).min(1).max(8),
            foreignTable: z.string().regex(PG_IDENTIFIER_REGEX),
            foreignColumns: z.array(z.string().regex(PG_IDENTIFIER_REGEX)).min(1).max(8),
          })
          .transform((e) => {
            const parent = e.parentColumns.join(',');
            const foreign = e.foreignColumns.join(',');
            return `${parent},${e.foreignTable}(${foreign})`;
          }),
      },
    },
    bodySchema: z.undefined(),
  },
  // 39b codex 39b-cleanup-strategy-not-enforced [APPLIED]: observational GET
  // — no row creation by the probe itself.
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
};
