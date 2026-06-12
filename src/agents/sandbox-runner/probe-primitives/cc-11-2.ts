import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const SEGMENT_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * cc-11-2 — non-admin actor reaches an admin-shaped route. AI authors path
 * segments under `/api/admin/`.
 *
 * blast_radius: `admin_access` (codex 39b-006 [APPLIED]; canonical value
 * from the Finding model — was `admin_surface` in v1, NOT in the union).
 */
export const CC_11_2: ProbePrimitive = {
  id: 'cc-11-2-non-admin-admin-route',
  control_id: 'cc-11-2',
  title: 'Non-admin actor reaches an admin-shaped route',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/api/admin/{pathSegments}' },
    pathParams: {
      pathSegments: {
        mode: 'ai_authored',
        schema: z
          .array(z.string().regex(SEGMENT_REGEX))
          .min(1)
          .max(4)
          .transform((segs) => segs.join('/')),
      },
    },
    bodySchema: z.undefined(),
  },
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
};
