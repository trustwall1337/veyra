/**
 * cc-11-13e — `?<private_column>=eq.<known_value>` returns rows when
 * the column should NOT be queryable by this actor. Per step file:
 * proven_allowed ONLY when non-empty rows are returned. Empty
 * response is inconclusive (RLS-filter vs no-match indistinguishable
 * from outside; no side-channel reasoning).
 */
import { buildResult, type CatalogEntry, type NegativeTestInput } from './types.js';

export const controlId = 'cc-11-13e';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (
    response.status === 200 &&
    Array.isArray(response.body) &&
    response.body.length > 0
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-13e-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: { filter_target: input.target.url },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'private-column filter returns rows to non-admin actor',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
