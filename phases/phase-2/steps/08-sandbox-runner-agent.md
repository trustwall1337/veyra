# Step 08 — `sandbox-runner` agent

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 6`, §3.3, §4.9, §12 (false-positive control)
**Produces:** agent (`src/agents/sandbox-runner/`)
**Depends on:** 06, 07
**Executed by:** `/new-agent` skill
**Verification:** per-test outcome tests against recorded HTTP fixtures; assertion-strictness test (vague response → `inconclusive`); per-test + per-scan timeout tests

## Goal

Execute the test plan. Each entry → load catalog test → sign-in as the synthetic identity → fire request → assert outcome → emit `ActiveValidationResult`. Per-test timeout. Per-scan wall-clock cap (default 5 min, configurable up to 15).

## What lands

- `src/agents/sandbox-runner/agent.ts` — implements `VeyraAgent`. Loads `scan-plan.json` + `synthetic-resources.json`; for each plan entry, looks up the catalog test by `controlId`; runs it; aggregates `ActiveValidationResult[]`.
- `src/agents/sandbox-runner/jwt-session.ts` — small helper: signs in a synthetic identity via Supabase Auth (NOT service-role), retrieves a session JWT, returns a `fetch`-compatible client that injects the JWT. Sessions are kept in-memory per scan; deleted on Cleanup.
- `src/agents/sandbox-runner/budget.ts` — per-scan wall-clock budget + per-test timeout. Aborts remaining tests if budget exhausted; remaining entries become `inconclusive` with the budget-exceeded `assertion_details`.
- Output artifact: `active-validation-results.json` keyed by `test_id`.

## Done when

- Per-test outcome tests pass against recorded-HTTP fixtures: clear deny → `proven_denial`; clear allow → `proven_allowed`; ambiguous → `inconclusive`.
- Strictness test: feed a response that does NOT match the catalog's assertion shape → outcome is `inconclusive`, NOT `proven_allowed`.
- Per-test timeout test: feed a slow fixture → outcome is `inconclusive` with `assertion_details: 'timeout'`.
- Per-scan budget test: enough tests to exceed 5 min → remaining tests marked `inconclusive` with `assertion_details: 'budget_exceeded'`.
- Agent does NOT promote any finding to `confirmed_issue`. That promotion happens only in `evidence-report` (step 10e) via `proven_allowed`.

## Guardrails

- Per `§4.9`: uses synthetic identity JWTs only. Service-role key is forbidden in this agent.
- Per `§4.9`: tests are bounded in time. No retries on failure. No exponential backoff (that's a load test, not active validation).
- Per `§12`: assertion strictness is non-negotiable. `proven_allowed` requires a specific assertion that the row/response could not have come from a legitimate scenario.
- Per `§4.0`: agent does not call any other agent directly. Reads `scan-plan.json` + `synthetic-resources.json`, writes `active-validation-results.json`.
- Per `FPP §2A`: catalog lookup is by `controlId`. No `switch (controlId)` in this agent.

## References

- `PHASE_2_PLAN.md` §3.3 (Exercise semantics), §4.9 (controls), §12 (assertion strictness)
- Step 06 `synthetic-resources.json` (consumer)
- Step 07 negative-test catalog (consumer)
- `.claude/skills/new-agent/SKILL.md`
