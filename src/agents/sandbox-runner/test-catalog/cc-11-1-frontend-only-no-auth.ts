/**
 * cc-11-1 — unauthenticated request to a route "protected" only by
 * frontend redirect. Active-validation flavor of the static cc-11-1
 * check from Phase 1.
 */

import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-1';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  // Strip the JWT — the whole point is "no auth header at all."
  const response = await input.transport.send({
    ...input.target,
    accessToken: '', // signal: no Authorization header
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (response.status === 200 && response.bodyByteLength > 0) outcome = 'proven_allowed';
  return buildResult({
    test_id: `cc-11-1-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      stripped_auth: true,
      route: input.target.url,
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'unauthenticated access to a frontend-only-protected route',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
