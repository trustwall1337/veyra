import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

/**
 * cc-11-3 IDOR — direct object access at /api/orders/{id} with a non-owning
 * identity. Moved from `probe-primitives.ts` to the per-control layout per
 * Step 39b Decision A.
 */
export const CC_11_3: ProbePrimitive = {
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
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
};
