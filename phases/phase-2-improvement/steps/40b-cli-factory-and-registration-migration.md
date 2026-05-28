# Step 40b — CLI factory + registration migration (orchestrator → loop)

**Status:** done (2026-05-28) — seam landed + structural-drift test; full physical retirement of `scan-orchestrator.ts` / `agent-registration.ts` deferred to step 40 (Mode B CLI wiring)
**Maps to:** `PLAN.md §G.1`
**Phase:** 3, Cut 1 (CLI cannot call the loop without it)
**Produces:** migration of the CLI seam from the topo-sort orchestrator to the agentic loop: `ScanCommandDeps.orchestratorFactory: () => ScanOrchestrator` → `loopFactory: () => AgenticLoop` (stays an injected field — preserves the fake-runner test seam, no circular dep per codex r2); `registerPhase1Agents(orch)` → `registerTools(catalog)` (Step 33's `tool-registration.ts`); migrate every test import.
**Depends on:** 31, 33
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) `runScan` constructs the loop via the injected `loopFactory`; (b) a structural test asserts NO production import of `createScanOrchestrator`/`registerPhase1Agents`/`ScanOrchestrator` remains outside `superseded/`; (c) the existing fake-runner test seam still works (deps injection preserved).

## Goal

Migrate the CLI call sites named in §G.1 (`scan-command.ts:13/19/222/791/935/1228`, `agent-registration.ts:114`) from the orchestrator factory to the loop factory + tool registration, without breaking the dependency-injection test seam. This is in Cut 1 because the CLI literally cannot invoke the loop until the seam is migrated.

## What lands

- `loopFactory` replaces `orchestratorFactory` in `ScanCommandDeps` (injected; default = the agentic loop).
- `registerTools(catalog)` replaces `registerPhase1Agents(orch)` at the call site.
- Test imports migrated; fake-runner seam preserved.
- Structural test per Verification.

## Done when

All Verification assertions pass. No production code constructs the old orchestrator; the loop is the runtime entry; tests green.

## Guardrails

- `loopFactory` stays injected (fake-runner seam preserved; no circular dep — codex r2 confirmed).
- The old `ScanOrchestrator`/`createScanOrchestrator`/`registerPhase1Agents` survive only under `superseded/` (or are deleted only after every consumer is migrated and tests are green).
- No behavior change beyond the seam swap.

## References

- `PLAN.md §G.1`; `scan-command.ts:13/19/222/791/935/1228`; `agent-registration.ts:114`
