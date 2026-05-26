/**
 * cc-11-12 — anonymous fetch on a supposedly-private bucket.
 */
import {
  buildResult,
  type CatalogEntry,
  type NegativeTestInput,
} from './types.js';

export const controlId = 'cc-11-12';

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: '', // anonymous; strip JWT
  });
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 403 || response.status === 401) outcome = 'proven_denial';
  else if (response.status === 200 && response.bodyByteLength > 0) outcome = 'proven_allowed';
  return buildResult({
    test_id: `cc-11-12-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: {
      anon_request: true,
      bucket_url: input.target.url,
    },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'anonymous fetch on a private storage bucket returns content',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
