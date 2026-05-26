/**
 * cc-11-5 — cross-tenant read when RLS is off.
 * Multi-variant: RLS-on fixture expects proven_denial; RLS-off
 * fixture expects proven_allowed.
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-5';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  // PostgREST returns 401/403 when RLS denies; 200 with rows when permitted.
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (Array.isArray(response.body) && response.body.length === 0) {
    // empty result set is RLS doing its job in PostgREST: row-level
    // filtering returns [] rather than an error.
    outcome = 'proven_denial';
  } else if (
    response.status === 200 &&
    Array.isArray(response.body) &&
    response.body.length > 0
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-5-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      actor_tenant: input.actor.tenant_id ?? null,
      row_count: Array.isArray(response.body) ? response.body.length : 0,
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'cross-tenant table read with no RLS or RLS-off',
  run,
  expected_outcomes_on_fixture: [
    { variant_id: 'rls_off', outcome: 'proven_allowed' },
    { variant_id: 'rls_on', outcome: 'proven_denial' },
  ],
};
export default entry;
