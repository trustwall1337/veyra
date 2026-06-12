# Step 35 — Deterministic floor: sole Finding producer + sole classification site

**Status:** done (2026-05-28)
**Maps to:** `PLAN.md §B` (floor), `§D.1`/`§D.2` (classification preservation), `§K` (ledger gaps)
**Phase:** 3, Cut 1
**Produces:** post-loop floor in `src/core/orchestrator/` (or a floor module it owns) running classification predicates over loop-collected facts; relocates the classification half of `supabase-rls/predicates.ts:194/395` + `agent.ts:773/787` (and the other predicate agents) into the floor; salvages `hypothesis-disposition` deterministic emission.
**Depends on:** 31, 33
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; the three §D.2 tests pass: (i) compile guard — a `ToolResult` with a `finding_type` key does not typecheck (`@ts-expect-error`); (ii) runtime recursive guard — a result carrying `finding_type` at ANY nesting depth fails `safeParse` → `tool_result_reject`, floor still runs; (iii) **broadened import-graph walk** — a checked-in graph-walk starting from every registered concrete tool entrypoint (`src/scanners/*/tool.ts`, `src/connectors/*/tools/*`, `src/agents/*/tools/*`, derived from `tool-registration.ts`) + transitive helper imports asserts `Finding` (`src/types/finding.ts`) is unreachable from any reachable node (TS import resolution, not grep — re-export/alias cannot launder).

## Goal

The deterministic floor is the SOLE Finding producer and the SOLE classification site, preserving the Obs 8 invariant under the agentic loop. Tools emit facts only; the floor — running AFTER the loop over parsed-accepted facts — classifies them into Findings via the same deterministic predicates the topo-sort used. The three tests make this mechanically un-bypassable, not a prose promise.

## What lands

- The floor: `collectFacts(state)` (accepted results only) → `runClassificationPredicates(facts, ledger.gaps(state))`.
- Relocation: fact-extraction half of each predicate agent → its read/parse tool (Step 33); classification half (`finding_type` assignment) → the floor.
- The three §D.2 tests, especially the import-graph walk.

## Done when

All three §D.2 tests pass. No file reachable from any tool's `invoke` imports `Finding`. The floor produces the expected findings on the fixture.

## Guardrails

- Per CLAUDE.md §10 / FPP §12: AI never produces a Finding, never classifies. Enforced here by schema (un-representable in-loop) + the import-graph guard (Finding unreachable from tools).
- Heuristic findings stay `likely_issue`; only scanner-direct/active-proven may be `confirmed_issue` — unchanged.
- The floor consumes facts identically whether they came from the AI loop or the `--no-ai` plan-walker.

## References

- `PLAN.md §B`, `§D.1`, `§D.2`, `§K`; `supabase-rls/predicates.ts:194/395`, `agent.ts:773/787`; `src/types/finding.ts`; `src/core/assertions/hypothesis-disposition.ts`
