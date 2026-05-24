# Step 15 — Phase 2 end-to-end fixture validation gate

**Status:** not started
**Maps to:** `PHASE_2_PLAN §8` success criteria
**Produces:** verification only (no new `src/` code; new `.claude/commands/scan-fixture-active.md` if step 01 decision 6 chose "new command")
**Depends on:** 14, 13
**Executed by:** `/scan-fixture-active` command (or `/scan-fixture` extended — per step 01 decision 6) + `output-language-lint` subagent + `plan-adherence` subagent
**Verification:** every assertion in `§8` fires green

## Goal

The gate that says "Phase 2 is done." No new code. Run the full Mode B pipeline against the sandbox fixture from step 13 and confirm every success criterion.

## What lands

- Either a new `.claude/commands/scan-fixture-active.md` OR an extension to `.claude/commands/scan-fixture.md`, depending on step 01 decision 6.
- A test harness file under `examples/vulnerable-lovable-supabase/sandbox-fixture/` that reads `expected-outcomes.json` and asserts the scan's `control-cards.json` matches.

## Done when

All of the following hold against the extended vulnerable fixture from step 13:

- `--mode sandbox_active_validation` against the sandbox produces:
  - `proven_allowed` for the seeded `cc-11-5` RLS-OFF table variant (cross-tenant SELECT succeeds — proves the gap)
  - `proven_denial` for the seeded `cc-11-5` RLS-ON table variant (cross-tenant SELECT denied — proves the control works when enabled); rule 2 of step 10e then computes `readiness_status: proven_in_sandbox` for that variant even though the heuristic strength was `high`
  - `proven_allowed` for the seeded `cc-11-6` `USING (true)` policy table
  - `proven_allowed` for the seeded `cc-11-12` public bucket (anon download)
  - `proven_allowed` for `cc-11-4` client-tenant_id override
  - `proven_denial` or `proven_allowed` for `cc-11-3` direct-object-access, depending on fixture variant
- `cleanup-proof.json` shows `residual_count: 0` per resource type.
- The report renders AI-enriched explanations under a distinct heading. Each AI output has `confidence` and `uncertainty_notes`.
- `--no-ai` produces a complete report; deterministic + active findings still surface.
- `--mode sandbox_active_validation --env production` is rejected at parse time.
- `--mode sandbox_active_validation` without `--approve-active` is rejected at parse time.
- `scan-actions.log` records every Supabase Admin API call, every AI prompt, every scanner subprocess. Args fingerprints are SHA-256.
- An induced cleanup failure (kill the manager mid-Cleanup) results in non-zero exit, a residual report, NO `proven_in_sandbox` claims, AND a `confirmed_issue + fix_before_launch` finding flagging the failed cleanup.
- `output-language-lint` returns zero hits across the report.
- `plan-adherence` on the diff: zero cross-agent imports introduced.

## Failure modes and what they mean

- Outcome mismatch: agent's plan entry or sandbox-runner's assertion has drifted. Fix the agent or the assertion, NOT `expected-outcomes.json`.
- `residual_count > 0`: cleanup failed. This is a Veyra-itself bug — fix it before claiming Phase 2 is done.
- Language lint hit: a string somewhere uses forbidden vocabulary. Fix the string.
- Re-run produces different `control-cards.json` (non-determinism): a renderer or readiness rule has hidden state. Identify and fix.

## Guardrails

- Do NOT loosen `expected-outcomes.json` to make findings "pass."
- Do NOT widen the language lint allowlist.
- Do NOT promote a finding to `confirmed_issue` to satisfy an outcome assertion. Only `proven_allowed` promotes; if the scenario can't actually produce `proven_allowed`, the catalog test or fixture seed is wrong.
- Do NOT mark `inconclusive` results as `proven_*` for convenience.

## References

- `PHASE_2_PLAN.md` §8 (Success criteria), §9 (non-claims)
- Phase 1 step 19 (Mode A fixture gate — mirror)
- Step 13 sandbox fixture + `expected-outcomes.json`
- `.claude/agents/output-language-lint.md`, `.claude/agents/plan-adherence.md`
