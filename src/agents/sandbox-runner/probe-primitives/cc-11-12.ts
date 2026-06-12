import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const BUCKET_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const SEGMENT_REGEX = /^[a-zA-Z0-9_.-]{1,64}$/;

/**
 * cc-11-12 — anon-readable object in a Supabase private bucket.
 */
export const CC_11_12: ProbePrimitive = {
  id: 'cc-11-12-anon-private-bucket',
  control_id: 'cc-11-12',
  title: 'Anon-readable object inside a private bucket',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: {
      mode: 'fixed',
      value: '/storage/v1/object/{bucket}/{pathSegments}',
    },
    pathParams: {
      bucket: {
        mode: 'ai_authored',
        schema: z.string().regex(BUCKET_REGEX),
      },
      pathSegments: {
        mode: 'ai_authored',
        schema: z
          .array(z.string().regex(SEGMENT_REGEX))
          .min(1)
          .max(8)
          .transform((segs) => segs.join('/')),
      },
    },
    bodySchema: z.undefined(),
  },
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
};
