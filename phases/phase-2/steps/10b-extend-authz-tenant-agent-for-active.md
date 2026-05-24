# Step 10b — Extend `authz-tenant` agent for active validation

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §4.x authz-tenant extension
**Produces:** agent extension (`src/agents/authz-tenant/`)
**Depends on:** 08
**Executed by:** plain coding pass guided by `/new-agent` extension checklist
**Verification:** `§11.4` client-tenant-id-override produces `proven_allowed` on fixture; cross-tenant read produces `proven_allowed` on `§11.3`-shaped seed

## Goal

Authz-tenant agent declares the cross-tenant tests it wants and reads back results to corroborate Phase 1 heuristic findings.

## What lands

- Extend `src/agents/authz-tenant/agent.ts` Plan-phase to emit `TestPlanEntry`s for:
  - `§11.3` direct-object-access on each sensitive route detected by Semgrep
  - `§11.4` client-tenant-id-override on each detected client-tenant-id usage
  - `§11.9` cross-tenant write attempts
- After Exercise, read back outcomes; emit corroboration metadata for step 10e.
- Coverage gaps on routes that couldn't be tested actively (e.g. no synthetic resource type matches) stay `coverage_gap`, not silent absence.

## Done when

- Fixture run with Mode B: `§11.4` client-tenant-id-override → schema-side `likely_issue` + active `proven_allowed` → upgraded.
- Fixture run with Mode B: `§11.3` direct-object-access → outcome (proven_allowed or proven_denial) recorded per seeded fixture variant.
- Fixture run with Mode A: no active plan entries emitted; agent behavior unchanged.

## Guardrails

- Per `§4.3`: agent confirms findings only when evidence is direct — and per `§5.3`, only `proven_allowed` is direct enough to promote.
- Per `§4.x`: results read via artifact store; no imports from sibling agents.
- Per `§12`: suggested tests still use §9 vocabulary ("negative tests should be added"), even when active results corroborate findings.

## References

- `PHASE_2_PLAN.md` §4.x authz-tenant extension, §5.3 (promotion path)
- Phase 1 step 11 (authz-tenant baseline)
- Step 02 `TestPlanEntry`
- Step 07 catalog tests `cc-11-3`, `cc-11-4`, `cc-11-9`
