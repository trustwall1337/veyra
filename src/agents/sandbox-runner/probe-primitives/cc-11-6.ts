import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * cc-11-6 — broad RLS exposing cross-tenant rows on a GET of /rest/v1/{table}
 * with a non-owning identity.
 */
export const CC_11_6: ProbePrimitive = {
  id: 'cc-11-6-broad-rls-cross-tenant',
  control_id: 'cc-11-6',
  title: 'Broad RLS exposes cross-tenant rows on GET /rest/v1/{table}',
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
