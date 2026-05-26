# Step 07d — PostgREST query-surface checks (cc-11-13 catalog additions)

**Status:** done (2026-05-26)
**Maps to:** `PHASE_2_PLAN §11.13` (new control category — see PHASE_2_PLAN amendment); `REVISION_AI_SHAPE §3.3b RoleModel` (input to test parameterisation)
**Amends Phase 2 step:** 07 (negative-test catalog)
**Produces:** five new catalog files under `src/agents/sandbox-runner/test-catalog/`
**Depends on:** Phase 2 step 07 (catalog skeleton), Phase 2 step 06b OR step 06 (synthetic actors), Phase 1 02b (`RoleModel` type)
**Executed by:** plain coding pass
**Verification:** per-test outcome assertion fixtures (HTTP 200 with cross-tenant row → `proven_allowed`; HTTP 403 → `proven_denial`; other → `inconclusive`); five `controlId` exports validated against `controls.ts`

## Goal

Add **bounded** PostgREST query-surface authorization checks to the catalog. Tests what a regular authenticated user can do with legitimate Supabase REST query syntax against the project's PostgREST endpoint. **Not SQL injection.** No payloads, no fuzzing, no brute-force, no destructive operations.

## Why this matters

Supabase exposes every RLS-enabled table at `https://<project>.supabase.co/rest/v1/<table>` and accepts PostgREST query operators (`?id=eq.123`, `?select=*`, `?or=(...)`, `?<col>=neq.<value>`, foreign-table embeds). A regular user with a valid JWT can compose any of these. If RLS is misconfigured or app-layer authorization is naive, the API can leak data the user shouldn't see — through a perfectly legitimate request.

## What lands

Five new catalog files, one per sub-check, under `src/agents/sandbox-runner/test-catalog/`:

- `cc-11-13a-openapi-table-enumeration.ts` — GET `/rest/v1/` (the OpenAPI spec endpoint). Compare advertised tables against `role-model.json.tenancy.scoped_resources` + the declared-context's "non-sensitive" set. **Outcome rules:** active outcome is always `inconclusive` for this check — spec advertising a table is exposure evidence, NOT proof of unauthorized read. The mismatch (tables in spec but not in declared accessible set) becomes a static `likely_issue + needs_review` finding via the supabase-rls predicate path. To confirm actual unauthorized access, the runner OR a follow-up `cc-11-13b` test must attempt a read against one of the advertised tables and succeed; only then does `proven_allowed` get emitted (against `cc-11-13b`, not against `cc-11-13a`).
- `cc-11-13b-select-star-column-leak.ts` — As synthetic actor A, `GET /rest/v1/<table>?select=*` against a table A can read. **Assertion:** response includes columns declared private in `role-model.json` (e.g. `password_hash`, `internal_notes`, `pii_*`) → `proven_allowed`.
- `cc-11-13c-cross-tenant-filter-bypass.ts` — As actor A, `GET /rest/v1/<tenant_scoped_table>?tenant_id=neq.<A_tenant>` (or `?or=(tenant_id.eq.t1,tenant_id.eq.t2)`). **Assertion:** response contains rows where `tenant_id != A.tenant_id` → `proven_allowed`.
- `cc-11-13d-foreign-table-embed-leak.ts` — As actor A, `GET /rest/v1/<accessible_table>?select=*,<related_sensitive_table>(*)`. **Assertion:** embedded join returns cross-tenant rows OR sensitive columns from the related table → `proven_allowed`.
- `cc-11-13e-private-column-filter-enumeration.ts` — As actor A, `GET /rest/v1/<table>?<declared_private_column>=eq.<known_value_from_declared_context>`. **Outcome rules:** `proven_allowed` is emitted **only** if the response contains non-empty rows that match the filter — i.e. actual data was returned to actor A using a column they shouldn't be able to filter on. An empty-array response is `inconclusive` (could mean RLS denied via row-level filter, could mean no matching rows existed; the two are indistinguishable from the outside). HTTP 403 / 401 is `proven_denial`. **No side-channel reasoning** (timing, response shape, error message content); this check explicitly does NOT explore filter-accepted-vs-filter-rejected distinctions, because that path is closer to enumeration than to authz testing.

Each file exports:
- `controlId: 'cc-11-13a' | ... | 'cc-11-13e'`
- `run(input: NegativeTestInput): Promise<ActiveValidationResult>` — pure function. **One HTTP request per invocation. Catalog test never retries, never escalates, never fuzzes parameters.**
- `expected_outcomes_on_fixture: ...` per `(control_id, variant_id)` shape (per Phase 2 step 13).

## Done when

- Five catalog files exist; their `controlId` exports validate against `controls.ts` (step 14b drift guard).
- Per-test recorded-HTTP fixtures: HTTP 200 + cross-tenant row body → `proven_allowed`; HTTP 403 → `proven_denial`; ambiguous body or HTTP 5xx → `inconclusive`. Both directions tested.
- The sandbox-runner (step 08) consumes these catalog entries without modification — the runner is catalog-agnostic.
- Input from `role-model.json` is required; missing role-model → tests emit `inconclusive` for the sub-checks that need it (column-level checks especially).
- `controls.ts` (step 14b) gains entries for `cc-11-13a` through `cc-11-13e` with `required_scenario_set` declared (e.g. `cc-11-13c` requires `neq`, `or`, and `not.in` variants for full coverage).

## Guardrails — the line we will not cross

- **No classic SQL injection payloads.** No `' OR 1=1`, no `'; DROP TABLE`, no `UNION SELECT`. PostgREST is parameterized; these prove nothing and conflict with `FPP §18` (no offensive testing).
- **No fuzzing.** Each test sends one request with one specific assertion. No iterating operators, no wordlist-based table-name guesses.
- **No table-name brute force.** Targets come from `role-model.json.tenancy.scoped_resources` + the OpenAPI spec only.
- **No filter-value brute force.** `cc-11-13e` tests filter-on-private-column with one specific value from declared context (e.g. the operator's known test value) — not iterated guesses.
- **No destructive operations.** GET only. Never POST/PATCH/DELETE in these checks.
- **No production.** `--env production` rejected for Mode B at parse time (PHASE_2_PLAN §2).

If any future change pushes a sub-check toward the forbidden list (e.g. "let's iterate column names to find more leaks"), the change is rejected; that's the offensive-testing line.

## Where this maps in the report

`AIConcern` for hypotheses about query-surface risks → `Finding` only when a sub-check returns `proven_allowed`. The reporter (step 13b / Phase 2 step 12) renders them under the existing Findings tier with `blast_radius: tenant_data | private_files | admin_access` as appropriate.

## References

- `PHASE_2_PLAN.md §11.13` (control category)
- `REVISION_AI_SHAPE.md §3.3b RoleModel` (input to test parameterisation)
- Phase 2 step 07 (catalog skeleton)
- Phase 2 step 14b `controls.ts` (where the `cc-11-13a..e` entries live)
- `FPP §18` ("What Not To Build First") — explicitly notes no offensive testing; this step stays inside that line
