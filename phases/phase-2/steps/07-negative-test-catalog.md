# Step 07 — Negative-test catalog (keyed by `control_id`)

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 5`, §12 (catalog-drift risk)
**Produces:** test catalog under `src/agents/sandbox-runner/test-catalog/` (one file per `control_id`)
**Depends on:** 02
**Executed by:** plain coding pass
**Verification:** Vitest test asserts every catalog file's filename exists as a `control_id` in `controls.ts` and vice-versa for Phase-2-active-supported controls

## Goal

Build the checked-in catalog of negative tests. Each test is a pure function from `(synthetic_resources, target_endpoint)` to `ActiveValidationResult`. Phase 2 ships seven tests; the catalog is open-ended (new controls can register their own tests in future phases).

## What lands

One file per `control_id` under `src/agents/sandbox-runner/test-catalog/`. Filenames match `controls.ts` `control_id`s (lowercase + dot-to-dash, e.g. `cc-11-3-direct-object-access.ts`):

- `cc-11-3-direct-object-access.ts` — synthetic actor A tries to GET `<object_endpoint>/<actor-B-object-id>`. Assertion: response status, response body row count > 0 AND row.tenant_id != actor.tenant_id → `proven_allowed`.
- `cc-11-4-client-tenant-id-override.ts` — actor A submits a request with `tenant_id` body field set to B's tenant_id. Assertion: same shape as above.
- `cc-11-5-cross-tenant-read-rls-off.ts` — actor A queries a table directly via the JS client. Expects `proven_denial` if RLS is on; `proven_allowed` if RLS is off.
- `cc-11-6-broad-rls-policy.ts` — same shape; tests a policy `USING (true)` table.
- `cc-11-9-cross-tenant-write.ts` — actor A tries to write to actor B's row.
- `cc-11-12-anon-to-private-bucket.ts` — anonymous fetch on a supposedly-private bucket. Assertion: HTTP 200 with content → `proven_allowed`; HTTP 403 → `proven_denial`; other → `inconclusive`.
- Plus `cc-11-2-non-admin-to-admin-route.ts` — synthetic non-admin actor calls `/admin/*` endpoint.

Each file exports:
- `controlId: ControlId` (matches filename)
- `run(input: NegativeTestInput): Promise<ActiveValidationResult>` — pure function (network is the only IO; result is fully determined by HTTP response)
- `expected_outcomes_on_fixture: 'proven_denial' | 'proven_allowed' | 'inconclusive'` (used by step 13 expected-outcomes generator)

## Done when

- Every file exports a typed `controlId` matching its filename.
- Build fails if a catalog file references a `controlId` not in `controls.ts` (drift guard test).
- Build fails if `controls.ts` declares a Phase-2-active-supported control without a corresponding catalog file (other-direction drift guard test).
- Each test has a positive and a negative recorded-HTTP fixture proving outcome detection works in both directions.

## Guardrails

- Per `§12` (catalog-drift): filename = `controlId`. Renaming a `controlId` in `controls.ts` requires renaming the catalog file in the same commit.
- Per `§12` (false-positive control): `proven_allowed` requires a specific assertion (e.g. `row.tenant_id != actor.tenant_id`). Vague responses route to `inconclusive`, not `proven_allowed`.
- Tests use the synthetic identity's JWT (NOT service-role). The catalog has no privileged-key access.
- Tests do not generate synthetic resources themselves — they receive them as input. The synthetic-data-manager owns lifecycle.
- No fuzzing, no brute force, no rate-attack patterns. Each test is a single deterministic request.

## References

- `PHASE_2_PLAN.md` §3.3 (Exercise semantics), §12 (catalog-drift + false-positive risks)
- `FINAL_PRODUCT_PLAN.md` §11 (12 initial checks → `control_id`s)
- Phase 1 step 14 `controls.ts` (canonical catalog)
- Step 02 `ActiveValidationResult`, `TestPlanEntry`
