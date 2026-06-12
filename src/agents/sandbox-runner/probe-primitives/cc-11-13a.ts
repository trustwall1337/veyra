import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

/**
 * cc-11-13a — anon OpenAPI enumeration: PostgREST's root advertises every
 * table and column. Always inconclusive (Decision L per step 39b): spec
 * advertising a table is exposure evidence, not proof of unauthorized
 * read. The floor emits a `coverage_gap` finding for inconclusive outcomes.
 *
 * Fully fixed — no AI-authored fields.
 */
export const CC_11_13A: ProbePrimitive = {
  id: 'cc-11-13a-openapi-enumeration',
  control_id: 'cc-11-13a',
  title: 'PostgREST OpenAPI enumeration',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/rest/v1/' },
    pathParams: {},
    bodySchema: z.undefined(),
  },
  requiredActions: ['call_api_with_test_identity'],
  cleanup_strategy: 'audit_only',
  uncertainty_notes:
    'spec advertising a table is exposure evidence, not proof of unauthorized read; outcome is always inconclusive',
};
