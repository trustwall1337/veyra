/**
 * cc-11-4 — actor A submits a request with `tenant_id` body field
 * set to B's tenant_id (client-supplied override).
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-4';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403 || response.status === 422) {
    outcome = 'proven_denial';
  } else if (
    (response.status === 200 || response.status === 201) &&
    response.bodyByteLength > 0
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-4-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      actor_tenant: input.actor.tenant_id ?? null,
      submitted_body_keys:
        input.target.body !== undefined ? Object.keys(input.target.body) : [],
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'client-supplied tenant_id body field overrides actor tenant',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
