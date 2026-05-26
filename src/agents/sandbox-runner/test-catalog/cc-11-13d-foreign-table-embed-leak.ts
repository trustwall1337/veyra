/**
 * cc-11-13d — `?select=*,related_sensitive(*)` foreign-table embed
 * exposes cross-tenant or sensitive columns via the join.
 */
import { buildResult, type CatalogEntry, type NegativeTestInput } from './types.js';

export const controlId = 'cc-11-13d';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  const actorTenant = input.actor.tenant_id;
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (Array.isArray(response.body) && response.body.length === 0) outcome = 'proven_denial';
  else if (
    response.status === 200 &&
    Array.isArray(response.body) &&
    response.body.some((row) => {
      if (typeof row !== 'object' || row === null) return false;
      // Look at every embedded array field for cross-tenant content.
      for (const v of Object.values(row as Record<string, unknown>)) {
        if (!Array.isArray(v)) continue;
        for (const sub of v) {
          if (typeof sub !== 'object' || sub === null) continue;
          const t = (sub as Record<string, unknown>)['tenant_id'];
          if (typeof t === 'string' && t !== actorTenant) return true;
        }
      }
      return false;
    })
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-13d-${input.actor.id}`,
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
  description: 'foreign-table embed leaks cross-tenant rows',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
