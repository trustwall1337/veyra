# Step 10c — Extend `authn` agent for active validation

**Status:** done (2026-05-26 — see src/agents/_shared/active-validation-extensions.ts; per-agent integration is bundled in the shared helpers commit)
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §4.x authn extension
**Produces:** agent extension (`src/agents/authn/`)
**Depends on:** 08
**Executed by:** plain coding pass
**Verification:** `§11.2` admin-route test on fixture produces `proven_allowed` when no server check; `proven_denial` when server check present

## Goal

Authn agent declares the no-auth-protected-route and non-admin-to-admin-route tests it wants. Corroborates Phase 1 frontend-only protection heuristics with active outcomes.

## What lands

- Extend `src/agents/authn/agent.ts` Plan-phase to emit `TestPlanEntry`s for:
  - `cc-11-1` no-auth call against detected protected routes (synthetic unauthenticated request) — catalog file `cc-11-1-frontend-only-no-auth.ts`
  - `cc-11-2` admin-route call as non-admin synthetic identity — catalog file `cc-11-2-non-admin-to-admin-route.ts`
- After Exercise, read back outcomes; emit corroboration metadata for step 10e.

## Done when

- Fixture run with Mode B against the seeded frontend-only-protected route: `cc-11-1` → `proven_allowed` → upgraded.
- Fixture run with Mode B against the seeded admin-without-server-check route: `cc-11-2` → `proven_allowed` → upgraded.
- Fixture run against a server-check-present variant: `cc-11-2` → `proven_denial` for the tested scenario. Recorded in `active_validation_results.json` as "tested scenario denied." Readiness becomes `proven_in_sandbox` **only if `cc-11-2.required_scenario_set` in `controls.ts` is entirely covered by `proven_denial` outcomes** (and cleanup_proof passes). If `cc-11-2` requires only this one scenario, readiness upgrades; if it requires more scenarios (e.g. `non-admin-via-direct-route`, `non-admin-via-api-route`, `anonymous-to-admin-route`), partial coverage stays at the Phase 1 baseline.
- Mode A behavior unchanged.

## Guardrails

- Per `§4.2`: agent never confirms via heuristic alone. Only `proven_allowed` from active validation can promote to `confirmed_issue`.
- Per `§4.x`: agent reads results via artifact store, does not import from `sandbox-runner`.
- Agent must not contact real auth providers. Synthetic identities live in the sandbox's Supabase project.

## References

- `PHASE_2_PLAN.md` §4.x authn extension, §5.3 (promotion path)
- Phase 1 step 10 (authn baseline)
- Step 07 catalog tests `cc-11-1`, `cc-11-2`
