# Step 10a — Extend `supabase-rls` agent for active validation

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §4.x supabase-rls extension
**Produces:** agent extension (`src/agents/supabase-rls/`)
**Depends on:** 08
**Executed by:** plain coding pass guided by `/new-agent` extension checklist
**Verification:** schema-side `likely_issue` corroborated by `proven_allowed` → upgraded via step 10e; `proven_denial` recorded on RLS-on fixture variant

## Goal

The supabase-rls agent learns to emit `TestPlanEntry[]` for the controls it owns (`§11.5`, `§11.6`, `§11.12`, `§11.9`) and to read back the corresponding `ActiveValidationResult`s from `active-validation-results.json`.

## What lands

- Extend `src/agents/supabase-rls/agent.ts` Plan-phase output:
  - For each table flagged with `cc-11-5` (RLS off) → emit `TestPlanEntry { test_id: cc-11-5-<table>, control_id: 'cc-11-5', required_synthetic_resources: { identities: 2, tenants: 2 } }`
  - For each `cc-11-6` (broad `USING (true)`) → `cc-11-6-<table>` entry
  - For each `cc-11-9` (all-authenticated policy) → `cc-11-9-<table>` entry. The active test (catalog file `cc-11-9-all-auth-cross-tenant-access.ts`) attempts a cross-tenant SELECT under an authenticated session; if the policy grants all rows to `authenticated`, the read returns rows from other tenants → `proven_allowed`.
  - For each bucket flagged `cc-11-12` (public) → `cc-11-12-<bucket>` entry
- After Exercise, read `active-validation-results.json`; cross-reference outcomes against schema-side findings; emit corroboration/contradiction metadata that step 10e uses for promotion.
- Agent does NOT change its own classifications. Promotion logic lives in step 10e.

## Done when

- Fixture run with Mode B: `§11.6` (broad policy) → schema-side `likely_issue` + active `proven_allowed` → upgraded to `confirmed_issue` by step 10e.
- Fixture run with Mode B against an RLS-on variant: `§11.5` schema-side `likely_issue` + active `proven_denial` → readiness `proven_in_sandbox` for that control.
- Fixture run with Mode A (no active): schema-side findings emit as before, no `TestPlanEntry`s, no MCP changes.
- Agent contract unchanged for Mode A scans.

## Guardrails

- Per `§4.4`: agent still does not query user data, apply migrations, or change policies. Active tests run via `sandbox-runner` using synthetic identities; the supabase-rls agent only emits plan entries.
- Per `§4.x`: agent reads results via artifact store, does not import from `sandbox-runner`.
- Per `FPP §2A`: `TestPlanEntry.control_id` references `controls.ts`. No new strings invented here.

## References

- `PHASE_2_PLAN.md` §3.1 (Plan phase), §4.x supabase-rls extension, §5.3 (promotion path)
- Phase 1 step 09 (supabase-rls agent — baseline)
- Step 02 `TestPlanEntry`
- Step 08 sandbox-runner (consumer of plan entries)
