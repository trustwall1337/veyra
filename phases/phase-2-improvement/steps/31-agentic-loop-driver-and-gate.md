# Step 31 — Agentic loop driver + policy gate inner step + budget caps + per-tool + result boundaries

**Status:** not started
**Maps to:** `PLAN.md §B` (loop), `§D.1` (result boundary), `§E` (budget/termination), `§K` (ledger eval at done)
**Phase:** 3, Cut 1
**Produces:** `src/core/orchestrator/agentic-loop.ts` (replaces `scan-orchestrator.ts` as runtime entry; provider-agnostic `AiDriver`/`AiProvider` interface, no provider import here), `src/core/orchestrator/required-evidence-ledger.ts` (consumed; defined per §K — may co-land or depend on a sibling step).
**Depends on:** 30
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) AI proposal is a typed discriminated union validated before use; (b) **per-tool failure boundary** — a throwing tool records a `tool_error` fact+artifact, never rethrows, loop continues, floor still runs; (c) **result-parse-or-reject boundary** — `invoke` → `result_schema.safeParse` → on reject `tool_result_reject` (reason only, no raw payload) + continue; `collectFacts` has no path to raw invoke output; (d) three budget caps + stall-halt + done-doesn't-skip-floor; (e) at `done`, `ledger.baselineSatisfied(state)` is evaluated and an unsatisfied baseline → `early_done` record.

## Goal

The agentic loop becomes the orchestrator. AI proposes the next tool call; the deterministic policy gate authorizes it; the tool executes inside a deterministic try boundary; the result is parsed-or-rejected before it persists or feeds the floor; repeat until a deterministic termination fires. The topo-sort orchestrator is replaced. Two trust-critical boundaries land here: the per-tool failure boundary (salvaged from `scan-orchestrator.ts:185/329`) and the result-parse boundary (§D.1).

## What lands

- `agentic-loop.ts` implementing the §B sequence: propose → log → terminate-checks → resolve → gate → args-parse → invoke(try) → result-parse-or-reject → write.
- Provider-agnostic `AiDriver.proposeNext(view, descriptors)` interface (concrete provider is Step 31b).
- Gate inner step reuses `tool-policy.ts` `enforce()` + connector-policy fns (no new gate logic).
- Budget caps (D3: 40 / 5min / token cap) + `max_steps` backstop; denials/rejects/tool-errors/result-rejects count.
- Termination: done / budget / stall / driver-error; floor runs in all four.
- Tests per Verification.

## Done when

All Verification assertions pass. The loop runs end-to-end against a stubbed `AiDriver` (deterministic test double) over the existing fixture's read-only tools (once Step 33 registers them) and the floor produces findings.

## Guardrails

- Per CLAUDE.md §Validation policy: gate authorizes by `allowed_actions`, deterministic; AI's stated intent never flips a deny.
- No provider SDK import in this step — `AiDriver` is an interface; the Bedrock concrete provider is Step 31b.
- `collectFacts` reads ONLY parsed-accepted tool results — a test asserts no raw-invoke-output path to the floor.
- Per-tool boundary: one tool crashing never corrupts append-only state or blocks other calls.

## D6 sub-agent delta (per `PLAN.md §O`)

This step also parameterizes `run` into the depth-aware `runDeepDive(scope, ChildBudget, depth, parent_step)` shape (one driver, two entry depths; parent = depth 0, full catalog, root budget). Adds the `spawn_deep_dive` branch + the `runDeepDive` call site **wrapped in a parent-side whole-call `try/catch`** (codex r1 #1: a sub-agent can fail outside `tool.invoke`; the parent catch records `subagent_error`, marks the target for a §K `coverage_gap`, and continues). Adds `ChildBudget` as a **view over the root budget** (`reserveChild` clamps `requested_slice` to `remaining_root`, cannot raise any cap; sub-agent spend debits root counters across all dimensions — calls/wall-clock/cost/max_steps). Sub-agent runs sequentially (parent blocks on return → deterministic). The §C budget-no-escape unit test lands here.

## References

- `PLAN.md §B`, `§D.1`, `§E`, `§K`, `§O`; `scan-orchestrator.ts:185/329` (boundary salvaged); `src/core/policy/tool-policy.ts`; `decisions.md` D6
