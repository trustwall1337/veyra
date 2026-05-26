/**
 * cc-11-2 — non-admin synthetic actor calls /admin/* endpoint.
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-2';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (response.status === 200 && response.bodyByteLength > 0) outcome = 'proven_allowed';
  return buildResult({
    test_id: `cc-11-2-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      actor_role: input.actor.role,
      admin_route: input.target.url,
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'non-admin actor reaches /admin/* endpoint',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
