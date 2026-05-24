# Step 10d — Extend `business-logic` agent for active validation

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §4.x business-logic extension
**Produces:** agent extension (`src/agents/business-logic/`)
**Depends on:** 08
**Executed by:** plain coding pass
**Verification:** invented findings remain forbidden; only declared-context-applicable tests emit a `TestPlanEntry`; controls without unambiguous synthetic scenarios stay `coverage_gap`

## Goal

Business-logic agent declares active tests only where the declared context unambiguously supports one. Many business-logic concerns (self-approval, cross-tenant invitations, refunds) remain `coverage_gap` because no synthetic scenario can prove them without intent-shaped assumptions.

## What lands

- Extend `src/agents/business-logic/agent.ts` Plan-phase: walk the declared-context checklist from Phase 1 step 12; for each item where `declared-context.json` provides an unambiguous shape (e.g. "the project declares an `invitations` table with a `tenant_id` column"), emit a corresponding `TestPlanEntry`.
- For ambiguous items, the agent continues to emit `coverage_gap` findings with `suggested_tests` — these become the human-review prompts.
- After Exercise, read back outcomes; emit corroboration metadata.

## Done when

- The agent NEVER emits `confirmed_issue` on its own (assertion preserved from Phase 1).
- Promotions go through step 10e only via `proven_allowed`.
- Fixture run: at least one business-logic test emits a plan entry, and at least two business-logic concerns remain `coverage_gap` (proving the agent is honest about ambiguity).

## Guardrails

- Per `§4.5`: business-logic findings are never `confirmed_issue` unless backed by clear code/test evidence — and Phase 2 says the clear evidence path is `proven_allowed`.
- Per Phase 1 step 12: NO AI provider call in this agent. AI enrichment happens in `ai-explainer` (step 09), not here.
- Per `§4.x`: results read via artifact store; no imports from sibling agents.

## References

- `PHASE_2_PLAN.md` §4.x business-logic extension, §4.5 controls
- Phase 1 step 12 (business-logic baseline)
- Step 02 `TestPlanEntry`
