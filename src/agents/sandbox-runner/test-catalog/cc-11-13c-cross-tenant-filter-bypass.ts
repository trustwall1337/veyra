/**
 * cc-11-13c — `?tenant_id=neq.<A>` / `?or=(tenant_id.eq.t1,tenant_id.eq.t2)`
 * cross-tenant filter bypass.
 */
import { buildResult, type CatalogEntry, type NegativeTestInput } from './types.js';

export const controlId = 'cc-11-13c';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  const actorTenant = input.actor.tenant_id;
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (Array.isArray(response.body) && response.body.length === 0) {
    outcome = 'proven_denial';
  } else if (
    response.status === 200 &&
    Array.isArray(response.body) &&
    response.body.some((row) => {
      if (typeof row !== 'object' || row === null) return false;
      const t = (row as Record<string, unknown>)['tenant_id'];
      return typeof t === 'string' && t !== actorTenant;
    })
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-13c-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: { actor_tenant: actorTenant ?? null },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'cross-tenant data via neq / or PostgREST filters',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
