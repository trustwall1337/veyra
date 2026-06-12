import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
const FILTER_VALUE_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * cc-11-13c — cross-tenant filter bypass: the AI authors a PostgREST
 * filter that flips the tenant check (e.g. `tenant_id=neq.<self>`). The
 * URL builder constructs the query string from a STRUCTURED filter (closed
 * operator union) — AI does NOT author raw query syntax.
 *
 * V9c structured filter shape (codex 39b-url-schema-dynamic-keys
 * [APPLIED]).
 */
export const CC_11_13C: ProbePrimitive = {
  id: 'cc-11-13c-cross-tenant-filter-bypass',
  control_id: 'cc-11-13c',
  title: 'Cross-tenant filter bypass via PostgREST tenant-column predicate',
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
            tenantColumn: z.string().regex(PG_IDENTIFIER_REGEX),
            operator: z.enum(['neq', 'in', 'or_neq']),
            value: z.string().regex(FILTER_VALUE_REGEX),
          })
          .transform((f) => {
            const encVal = encodeURIComponent(f.value);
            if (f.operator === 'neq') return `${f.tenantColumn}=neq.${encVal}`;
            if (f.operator === 'in') return `${f.tenantColumn}=in.(${encVal})`;
            return `or=(${f.tenantColumn}.neq.${encVal})`;
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
