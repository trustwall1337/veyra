import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

import { detectProtectedJsonContent } from './body-predicates.js';

const SEGMENT_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * cc-11-1 — API route protected only by frontend / not server-side.
 *
 * The AI authors path segments (identifier-only); the URL builder joins
 * them under `/api/`. Per codex 39b-005, a 200 returning HTML / empty
 * body is treated as `inconclusive` (SPA shell, not protected-data
 * evidence) — the body-predicate enforces this at the floor.
 */
export const CC_11_1: ProbePrimitive = {
  id: 'cc-11-1-api-protected-route',
  control_id: 'cc-11-1',
  title: 'Access to a server-protected API route without a server-side authz check',
  requestSchema: {
    method: { mode: 'fixed', value: 'GET' },
    urlTemplate: { mode: 'fixed', value: '/api/{pathSegments}' },
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
  uncertainty_notes:
    '200 on /api/* with HTML or empty body is SPA shell or static-asset noise; promote to launch-blocker only with JSON-shaped protected content',
  // codex 39b-outcome-config-not-wired [APPLIED]: HTML-shell responses
  // classify as `inconclusive`, NOT proven_allowed.
  bodyPredicate: detectProtectedJsonContent,
};
