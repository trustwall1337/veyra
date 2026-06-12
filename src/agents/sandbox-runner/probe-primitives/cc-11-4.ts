import { z } from 'zod';

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

const PG_IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * cc-11-4 — tenant_id body-override (39b round: OBSERVATIONAL variant).
 *
 * The control checks whether a server honors a client-supplied tenant_id
 * field on insert/update over the JWT claim. The TRUE active test is a
 * POST that creates a row in another tenant — but the POST + reverse-
 * cleanup machinery (DELETE the created row by its primary key) requires
 * admin-row-tracking that probe-http doesn't currently have.
 *
 * 39b ships an OBSERVATIONAL variant: GET `/rest/v1/{table}` as actor A
 * and look for rows whose tenant_id != A's tenant. If such rows exist,
 * either (a) the server has previously accepted body-override POSTs, OR
 * (b) RLS isn't tenant-scoped at all (which cc-11-6 / cc-11-9 also
 * catch). Either way, body-override is a class of bug that's REACHABLE
 * on this surface — the observation is suggestive evidence.
 *
 * Step 39b codex 39b-cleanup-strategy-not-enforced [APPLIED]: changed
 * from POST + `reverse` to GET + `audit_only`. The active POST variant
 * is deferred — see uncertainty_notes.
 */
export const CC_11_4: ProbePrimitive = {
  id: 'cc-11-4-tenant-id-body-override',
  control_id: 'cc-11-4',
  title: 'tenant_id body-override (observational: cross-tenant rows visible to actor)',
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
  uncertainty_notes:
    '39b ships the OBSERVATIONAL variant of cc-11-4 (cross-tenant row visibility implies body-override is reachable). The active POST+cleanup variant is deferred to a follow-up step; it requires admin-row-tracking machinery probe-http does not currently expose.',
};
