# Step 32 — `--no-ai` deterministic plan-walker over the same tool catalog

**Status:** not started
**Maps to:** `PLAN.md §E` (`--no-ai`, option b), `decisions.md` D5
**Phase:** 3, Cut 1
**Produces:** `src/core/orchestrator/plan-walker.ts` — a deterministic driver that invokes the SAME tool catalog in fixed dependency order (replaces the AI loop driver under `--no-ai`); replaces the deprecated `ai-security-planner` deterministic-fallback role.
**Depends on:** 30, 31
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) read-only parity — `--no-ai` plan-walker produces a Findings set identical to a loop run (with a deterministic AI-driver stub) over the read-only tools on the fixture; (b) write-probe coverage_gap — under `--no-ai`, each write-probe control yields exactly one floor `coverage_gap` with the offline reason ("active write-probe requires AI planning; re-run without `--no-ai`").

## Goal

`--no-ai` stays a first-class product, not a stub. A deterministic plan-walker drives the same tool catalog + the same deterministic floor; only the driver differs from the AI loop. Per D5/§E option (b): read-only tools get full coverage offline; write probes needing an AI-authored target degrade to a floor `coverage_gap` (honest, not a synthesized-target guess).

## What lands

- `plan-walker.ts`: fixed dependency-ordered tool invocation (the old topo-sort order expressed as a static tool list), routed through the same gate + result-boundary + floor.
- The write-probe offline-reason `coverage_gap` emission.
- Parity + coverage_gap tests per Verification.

## Done when

Both Verification assertions pass. `--no-ai` produces a complete read-only report on the fixture; write probes are honestly marked offline-gapped.

## Guardrails

- Plan-walker shares the catalog + floor with the loop — no divergent second code path for findings.
- Per D5: write probes are NOT run with synthesized targets offline; they become `coverage_gap`.
- Deterministic: same input → same output (no AI, no nondeterminism).

## References

- `PLAN.md §E`; `decisions.md` D5; `ai-security-planner/agent.ts:94` (deterministic-fallback role replaced); `active-validation-policy-compiler.ts:125`
