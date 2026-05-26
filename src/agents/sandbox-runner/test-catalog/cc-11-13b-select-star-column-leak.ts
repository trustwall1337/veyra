/**
 * cc-11-13b — GET /rest/v1/<table>?select=* leaks declared-private
 * columns. Pass `privateColumns` via parameters.target or input
 * extension (caller supplies the role-model.json-derived set).
 */
import { buildResult, type CatalogEntry, type NegativeTestInput } from './types.js';

export const controlId = 'cc-11-13b';

function rowsExposePrivateColumns(
  body: unknown,
  privateCols: readonly string[],
): boolean {
  if (privateCols.length === 0) return false;
  const rows = Array.isArray(body) ? body : [body];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    for (const col of privateCols) {
      if (col in (row as Record<string, unknown>)) return true;
    }
  }
  return false;
}

async function run(input: NegativeTestInput) {
  const started_at = Date.now();
  const response = await input.transport.send({
    ...input.target,
    accessToken: input.accessToken,
  });
  const privateCols = Array.isArray(
    (input.target.body as Record<string, unknown> | undefined)?.['private_columns'],
  )
    ? ((input.target.body as Record<string, unknown>)['private_columns'] as string[])
    : [];
  let outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive' = 'inconclusive';
  if (response.status === 401 || response.status === 403) outcome = 'proven_denial';
  else if (
    response.status === 200 &&
    rowsExposePrivateColumns(response.body, privateCols)
  ) {
    outcome = 'proven_allowed';
  }
  return buildResult({
    test_id: `cc-11-13b-${input.actor.id}`,
    control_id: controlId,
    outcome,
    started_at,
    actor: input.actor,
    response,
    assertion_details: { private_columns_checked: privateCols },
  });
}

export const entry: CatalogEntry = {
  controlId,
  description: 'select=* leaks declared-private columns to non-admin actor',
  run,
  expected_outcomes_on_fixture: 'proven_allowed',
};
export default entry;
