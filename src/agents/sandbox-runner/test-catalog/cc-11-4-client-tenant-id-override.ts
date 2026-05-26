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

/**
 * Codex retro 2.07-tenant-override-false-positive: proven_allowed
 * requires SPECIFIC evidence that the server accepted the foreign
 * tenant_id. We compare the submitted body's tenant_id field against
 * the response object's tenant_id (when the response echoes the row),
 * AND require that the submitted value differs from the actor's
 * tenant. Any 200/201 without that cross-tenant proof routes to
 * `inconclusive`, not `proven_allowed`.
 */
function detectCrossTenantAcceptance(
  submittedBody: Readonly<Record<string, unknown>> | undefined,
  response: { readonly body: unknown },
  actorTenant: string | undefined,
): boolean {
  const submitted = submittedBody?.['tenant_id'];
  if (typeof submitted !== 'string' || submitted.length === 0) return false;
  if (submitted === actorTenant) return false; // not actually cross-tenant
  const body = response.body;
  if (typeof body !== 'object' || body === null) return false;
  const rt = (body as Record<string, unknown>)['tenant_id'];
  return typeof rt === 'string' && rt === submitted;
}

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
    detectCrossTenantAcceptance(input.target.body, response, input.actor.tenant_id)
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
      submitted_tenant: (input.target.body as Record<string, unknown> | undefined)?.['tenant_id'] ?? null,
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
