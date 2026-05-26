/**
 * cc-11-13a — PostgREST OpenAPI table enumeration probe.
 * Active outcome is ALWAYS inconclusive for this check — spec
 * advertising a table is exposure evidence, not proof of
 * unauthorized read (per step 2.07d §"What lands").
 */
import { buildResult, type CatalogEntry, type NegativeTestInput } from './types.js';

export const controlId = 'cc-11-13a';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  return buildResult({
    test_id: `cc-11-13a-${input.actor.id}`,
    control_id: controlId,
    outcome: 'inconclusive',
    started_at,
    actor: input.actor,
    response,
    assertion_details: { probe: 'rest/v1/ openapi spec; static finding emitted via supabase-rls' },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'PostgREST OpenAPI table enumeration (exposure probe)',
  run,
  expected_outcomes_on_fixture: 'inconclusive',
};
export default entry;
