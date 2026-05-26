/**
 * cc-11-6 — broad RLS policy (`USING (true)`) on a tenant-scoped table.
 * Same shape as cc-11-5 but the assertion semantics flag the broad
 * policy explicitly.
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-6';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (Array.isArray(response.body) && response.body.length === 0) outcome = 'proven_denial';
  else if (
    response.status === 200 &&
    Array.isArray(response.body) &&
    response.body.some((row) => {
      if (typeof row !== 'object' || row === null) return false;
      const t = (row as Record<string, unknown>)['tenant_id'];
      return typeof t === 'string' && t !== input.actor.tenant_id;
    })
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-6-${input.actor.id}`,
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
  description: 'broad RLS policy (USING true) lets actor read other tenants',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
