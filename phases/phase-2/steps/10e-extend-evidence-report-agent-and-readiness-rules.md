# Step 10e — Extend `evidence-report` agent + new readiness rules

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 8`, §5.2, §5.3
**Produces:** agent extension (`src/agents/evidence-report/readiness.ts`, `controls.ts`)
**Depends on:** 10a, 10b, 10c, 10d
**Executed by:** `/new-agent` extension pass
**Verification:** `readiness.ts` unit tests for each new rule; `--fail-on-blocker` exits non-zero on the new path

## Goal

The single place where Phase 2 promotion happens. Take upstream agents' corroboration metadata + `active-validation-results.json` + `cleanup-proof.json` → upgrade classifications and readiness statuses per `§5.2` and `§5.3`.

## What lands

- Update `src/agents/evidence-report/controls.ts` to add entries for any Phase 2 controls that didn't exist in Phase 1, AND add `phase_2_active_supported: boolean` metadata so the planner test in step 07 can validate the catalog.
- Update `src/agents/evidence-report/readiness.ts` with the new Phase 2 rules in this exact order:
  1. Any `confirmed_issue + fix_before_launch` → `launch_blocker` (Phase 1, unchanged)
  2. Any `likely_issue + evidence_strength: high + fix_before_launch` → `launch_blocker` (Phase 1, unchanged)
  3. Any `ActiveValidationResult.outcome === 'proven_allowed'` for a sensitive control → promote underlying finding from `likely_issue` to `confirmed_issue + fix_before_launch`, then rule 1 applies → `launch_blocker` (Phase 2, new)
  4. Any control with at least one `proven_denial` AND `cleanup-proof.json.residual_count === 0` → `readiness_status: proven_in_sandbox` (Phase 2, new)
  5. Any `coverage_gap` AND no contradicting evidence → `needs_review`
  6. Otherwise → `evidence_present`
- Update `--fail-on-blocker` exit-code logic: non-zero iff any control card has `readiness_status: launch_blocker`. Phase 1 step 14 covered this; step 10e extends the rule set without changing the gate semantics.

## Done when

- Unit tests cover each rule independently:
  - `proven_allowed` on a `§11.6` finding → `confirmed_issue` + `launch_blocker`
  - `proven_denial` on a `§11.5` finding + `residual_count: 0` → `proven_in_sandbox`
  - `proven_denial` on `§11.5` BUT `residual_count: 5` → NOT `proven_in_sandbox` (cleanup failed)
  - `inconclusive` outcome → no promotion, control stays at the Phase 1 classification
- Integration test: full fixture run with Mode B → `control-cards.json` shows the expected readiness state per control.
- `--fail-on-blocker` test: induced `proven_allowed` → non-zero exit.
- Phase 1 readiness rules unchanged for Mode A scans.

## Guardrails

- Promotion path is exclusively rule 3 above. AI never promotes. Heuristics never promote on their own.
- `proven_in_sandbox` requires BOTH `proven_denial` AND `residual_count: 0`. Cleanup failure means no `proven_in_sandbox` claims — per `§11.3`.
- `readiness_status` is computed deterministically. No AI input. No timestamps. Same upstream artifacts → same readiness output.
- Agent reads from artifact store only. No imports from sibling agents.

## References

- `PHASE_2_PLAN.md` §5.2 + §5.3 (readiness rules), §11.3 (cleanup gating)
- Phase 1 step 14 (`controls.ts` + `readiness.ts` baseline)
- Steps 10a–10d (upstream corroboration metadata)
