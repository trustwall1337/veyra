# Step 10c — Extend `authn` agent for active validation

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §4.x authn extension
**Produces:** agent extension (`src/agents/authn/`)
**Depends on:** 08
**Executed by:** plain coding pass
**Verification:** `§11.2` admin-route test on fixture produces `proven_allowed` when no server check; `proven_denial` when server check present

## Goal

Authn agent declares the no-auth-protected-route and non-admin-to-admin-route tests it wants. Corroborates Phase 1 frontend-only protection heuristics with active outcomes.

## What lands

- Extend `src/agents/authn/agent.ts` Plan-phase to emit `TestPlanEntry`s for:
  - `§11.1` no-auth call against detected protected routes (synthetic unauthenticated request)
  - `§11.2` admin-route call as non-admin synthetic identity
- After Exercise, read back outcomes; emit corroboration metadata for step 10e.

## Done when

- Fixture run with Mode B against the seeded frontend-only-protected route: `§11.1` → `proven_allowed` → upgraded.
- Fixture run with Mode B against the seeded admin-without-server-check route: `§11.2` → `proven_allowed` → upgraded.
- Fixture run against a server-check-present variant: `§11.2` → `proven_denial` → readiness `proven_in_sandbox`.
- Mode A behavior unchanged.

## Guardrails

- Per `§4.2`: agent never confirms via heuristic alone. Only `proven_allowed` from active validation can promote to `confirmed_issue`.
- Per `§4.x`: agent reads results via artifact store, does not import from `sandbox-runner`.
- Agent must not contact real auth providers. Synthetic identities live in the sandbox's Supabase project.

## References

- `PHASE_2_PLAN.md` §4.x authn extension, §5.3 (promotion path)
- Phase 1 step 10 (authn baseline)
- Step 07 catalog tests `cc-11-2`
