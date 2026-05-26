# Step 07b — AI Security Planner Agent (Phase 2)

**Status:** done (2026-05-26)
**Maps to:** `REVISION_AI_SHAPE.md §7.3`; `PHASE_2_PLAN §4 AI-first revision additions`
**Amends Phase 2 step:** none — new step file (lands after Phase 2 step 07 catalog ships)
**Produces:** agent at `src/agents/ai-security-planner/`
**Depends on:** Phase 2 step 07 (negative-test catalog), Phase 1 02c (`AiProvider`), Phase 1 02d (Anthropic adapter), Phase 1 17c (declared-context)
**Executed by:** `/new-agent` skill
**Verification:** planner-output-is-subset-of-catalog test; mandatory-baseline-omission test (compiler injects); `--no-ai` skip-path test

## Goal

Phase 2 AI agent that proposes scan plans from the **closed** negative-test catalog. Prioritises and parameterises entries based on declared context. **Cannot invent test types. Cannot delete from the mandatory baseline.** Output is gated by `ActiveValidationPolicyCompiler` (07c) before execution.

## What lands

- `src/agents/ai-security-planner/agent.ts`:
  - Reads `findings.json`, `declared-context.json`, the catalog manifest from Phase 2 step 07 (`test-catalog/*.ts` exports + their `controlId`s).
  - Calls `AiProvider.complete()` with a structured-output schema for `ProposedScanPlan`.
  - Writes `proposed-scan-plan.json`. Each entry has `test_id` (from the catalog), `priority`, `parameters` (from the catalog test's schema), `justification` (plain text).
  - **Cannot add entries with test_ids not in the catalog** — schema rejection at structured-output time.
  - **Cannot omit mandatory-baseline entries** — schema validates against the baseline; compiler at 07c injects any missing ones.
- The agent is invoked by the orchestrator (Phase 2 step 14) between `findings.json` emission and the sandbox-runner.

## Done when

- Planner-output-is-subset-of-catalog test: feed the agent a known fixture; assert every emitted `test_id` exists in `phases/phase-2/steps/07-negative-test-catalog.md`'s exported list.
- Mandatory-baseline-omission test: deliberately prompt-engineer the agent to omit `cc-11-5`; assert 07c compiler injects it back.
- `--no-ai` test: agent skipped; orchestrator uses the deterministic plan from `phases/phase-2/steps/10a-10d` directly.
- Every output has `confidence` + `uncertainty_notes` + `model_id` + `prompt_fingerprint_sha256`.
- Constraint 4 enforced (no new active tests invented).
- Constraint 6 enforced (cannot delete from mandatory baseline — compiler is the safety net).

## Guardrails

- **Constraint 4:** AI never invents new active tests. The catalog is checked-in code.
- **Constraint 6:** AI never deletes from the mandatory baseline. Compiler at 07c re-injects.
- Per `FPP §2A`: planner addresses tests by `controlId`, not by provider/scanner name. Adding a new test type = new catalog file + new predicate, no planner edits.
- Per `PHASE_2_PLAN §10.2`: no tool-use loops. Structured-output chat completion only.
- Sanitization on entry: declared-context + findings sanitized via 02c helpers before prompt construction.

## References

- `REVISION_AI_SHAPE.md` §7.3
- `PHASE_2_PLAN.md` §4 (AI Security Planner addition), §10 AI discipline
- `phases/phase-2/steps/07-negative-test-catalog.md` (the closed catalog this draws from)
- `phases/phase-1/steps/02c-ai-provider-types-and-sanitization.md`, `02d-anthropic-adapter.md`
