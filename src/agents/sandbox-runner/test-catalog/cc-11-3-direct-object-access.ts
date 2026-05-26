/**
 * cc-11-3 — actor A GETs /<endpoint>/<actor-B-object-id>.
 * Vague responses route to `inconclusive`, not `proven_allowed`
 * (§12 false-positive control).
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-3';

function rowsLeak(body: unknown, actorTenant: string | undefined): boolean {
  if (!Array.isArray(body)) {
    if (typeof body === 'object' && body !== null) {
      const t = (body as Record<string, unknown>)['tenant_id'];
      return typeof t === 'string' && t !== actorTenant;
    }
    return false;
  }
  return body.some((row) => {
    if (typeof row !== 'object' || row === null) return false;
    const t = (row as Record<string, unknown>)['tenant_id'];
    return typeof t === 'string' && t !== actorTenant;
  });
}

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (response.status === 404) outcome = 'proven_denial';
  else if (
    response.status === 200 &&
    response.bodyByteLength > 0 &&
    rowsLeak(response.body, input.actor.tenant_id)
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-3-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      actor_tenant: input.actor.tenant_id ?? null,
      object_url: input.target.url,
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'cross-tenant direct object access via id-in-URL',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
