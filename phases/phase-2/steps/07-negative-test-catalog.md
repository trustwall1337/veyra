# Step 07 — Negative-test catalog (keyed by `control_id`)

**Status:** done (2026-05-26)
**Maps to:** `PHASE_2_PLAN §7 Task 5`, §12 (catalog-drift risk)
**Produces:** test catalog under `src/agents/sandbox-runner/test-catalog/` (one file per `control_id`)
**Depends on:** 02
**Executed by:** plain coding pass
**Verification:** Vitest test asserts every catalog file's exported `controlId` constant exists in `controls.ts` (drift guard A) AND every Phase-2-active-supported `control_id` in `controls.ts` has a catalog file whose export matches (drift guard B)

## Goal

Build the checked-in catalog of negative tests. Each test is a pure function from `(synthetic_resources, target_endpoint)` to `ActiveValidationResult`. Phase 2 ships eight tests; the catalog is open-ended (new controls can register their own tests in future phases).

## What lands

Files live under `src/agents/sandbox-runner/test-catalog/`. **The drift guard checks the test's exported `controlId` constant against `controls.ts` — NOT filename equality** (filenames carry a human-readable suffix beyond the `control_id`). Filename convention: `<control_id>-<short-description>.ts`.

Phase 2 catalog (eight tests, each tagged with its FPP §11 `control_id`):

- `cc-11-1-frontend-only-no-auth.ts` — unauthenticated request to a route that is "protected" only by frontend redirect. Assertion: HTTP 200 with sensitive data → `proven_allowed`; HTTP 401/403 → `proven_denial`.
- `cc-11-2-non-admin-to-admin-route.ts` — synthetic non-admin actor calls `/admin/*` endpoint. Assertion: same shape.
- `cc-11-3-direct-object-access.ts` — actor A tries to GET `<object_endpoint>/<actor-B-object-id>`. Assertion: response status, response body row count > 0 AND row.tenant_id != actor.tenant_id → `proven_allowed`.
- `cc-11-4-client-tenant-id-override.ts` — actor A submits a request with `tenant_id` body field set to B's tenant_id. Assertion: same shape.
- `cc-11-5-cross-tenant-read-rls-off.ts` — actor A queries a table directly via the JS client. On RLS-off fixture variant → `proven_allowed`; on RLS-on fixture variant → `proven_denial`.
- `cc-11-6-broad-rls-policy.ts` — same shape against a table with `USING (true)` policy.
- `cc-11-9-all-auth-cross-tenant-access.ts` — actor A (authenticated, tenant A) queries a table whose policy grants all rows to `authenticated`. Assertion: response returns tenant B's rows → `proven_allowed`. Tests the all-authenticated policy specifically (per FPP §11 row 9).
- `cc-11-12-anon-to-private-bucket.ts` — anonymous fetch on a supposedly-private bucket. Assertion: HTTP 200 with content → `proven_allowed`; HTTP 403 → `proven_denial`; other → `inconclusive`.

Each file exports:
- `controlId: ControlId` — the canonical `cc-11-N` id (this is what the drift guard validates against `controls.ts`)
- `run(input: NegativeTestInput): Promise<ActiveValidationResult>` — pure function (network is the only IO; result is fully determined by HTTP response)
- `expected_outcomes_on_fixture: 'proven_denial' | 'proven_allowed' | 'inconclusive' | Array<{ variant_id, outcome }>` — for controls with multiple fixture variants (e.g. `cc-11-5` RLS-on vs RLS-off), use the array form. Step 13's expected-outcomes generator consumes this.

## Done when

- Every file exports a typed `controlId` that exists in `controls.ts`.
- Build fails if a catalog file's exported `controlId` is not in `controls.ts` (drift guard A).
- Build fails if `controls.ts` declares a Phase-2-active-supported control without a corresponding catalog file (drift guard B; resolved by scanning all `controlId` exports, NOT by filename equality).
- Each test has a positive and a negative recorded-HTTP fixture proving outcome detection works in both directions.
- Eight catalog files exist: `cc-11-1`, `cc-11-2`, `cc-11-3`, `cc-11-4`, `cc-11-5`, `cc-11-6`, `cc-11-9`, `cc-11-12`.

## Guardrails

- Per `§12` (catalog-drift): the drift guard checks the test's exported `controlId` constant — not the filename. Renaming a `controlId` in `controls.ts` requires updating every catalog file's `controlId` export in the same commit. Filenames are advisory (human-readable suffix); the export is authoritative.
- Per `§12` (false-positive control): `proven_allowed` requires a specific assertion (e.g. `row.tenant_id != actor.tenant_id`). Vague responses route to `inconclusive`, not `proven_allowed`.
- Tests use the synthetic identity's JWT (NOT service-role). The catalog has no privileged-key access.
- Tests do not generate synthetic resources themselves — they receive them as input. The synthetic-data-manager owns lifecycle.
- No fuzzing, no brute force, no rate-attack patterns. Each test is a single deterministic request.

## References

- `PHASE_2_PLAN.md` §3.3 (Exercise semantics), §12 (catalog-drift + false-positive risks)
- `FINAL_PRODUCT_PLAN.md` §11 (12 initial checks → `control_id`s)
- Phase 1 step 14 `controls.ts` (canonical catalog)
- Step 02 `ActiveValidationResult`, `TestPlanEntry`
