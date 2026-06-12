import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * cc-11-9 — all-auth-cross-tenant: any authenticated user can read rows
 * outside their tenant (RLS using `auth.role() = 'authenticated'` only,
 * no tenant gate).
 */
export const CC_11_9: ProbePrimitive = {
  id: 'cc-11-9-all-auth-cross-tenant',
  control_id: 'cc-11-9',
  title: 'Any authenticated user reads cross-tenant rows on /rest/v1/{table}',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/rest/v1/{table}' },
    pathParams: {
      table: {
        mode: 'ai_authored',
        schema: z.string().regex(PG_IDENTIFIER_REGEX),
      },
    },
    bodySchema: z.undefined(),
  },
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
};
