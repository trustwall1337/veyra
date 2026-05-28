# Step 41 — Agentic fixture gate: e2e + determinism + trust-invariant assertions

**Status:** not started
**Maps to:** `PLAN.md §H` Step 41, `§K` (ledger), `§D` (trust invariants)
**Phase:** 3 (Cut 1 partial; Cut 3 complete)
**Produces:** the Phase 3 acceptance gate — extends the fixture suite to run the full agentic pipeline and assert every trust invariant mechanically.
**Depends on:** 31–40b
**Executed by:** `scan-fixture`-style harness + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; the gate asserts:
1. **Agentic e2e** — a loop run (deterministic AI-driver stub) against the fixture produces a non-empty Findings set + an authored narrative + a `loop-trace.jsonl`.
2. **Determinism** — same fixture + same stubbed driver → byte-identical findings + trace (modulo scrubbed timestamps/uuids).
3. **Per-tool failure boundary** — a throwing tool → loop continues, `tool_error` artifact written, floor still produces findings + cleanup.
4. **Result-reject boundary** — a tool returning a `finding_type` key (any depth) → `tool_result_reject`, nothing persisted, floor still runs.
5. **Required-evidence ledger** — forced early `done` with an unsatisfied baseline item → exactly one floor `coverage_gap` per missing item; `LEDGER_ROW_COUNT` constant matches the table (Mode A=6, Mode B-add=2).
6. **Write-then-cleanup roundtrip (Cut 3)** — across BOTH write paths (1 HTTP write + 1 synthetic user) → `residual_count: 0`; induced cleanup failure → `cleanup_failed` launch-blocker.
7. **Trust invariants** — no Finding authored by AI (import-graph guard); no raw secret in trace/artifacts; gate denials logged; `execute_sql` has no descriptor; `--no-ai` produces a complete read-only report.
8. **(D6) sub-agent invariants** — (a) depth cap: a sub-agent's `spawn_deep_dive` is `spawn_denied(depth_cap)`, no `subagent_depth>1` row exists; (b) budget no-escape across ALL dimensions (calls/wall-clock/cost/max_steps): `reserveChild(requested>remaining)` clamps, caps immutable, child spend debits root, child denials/errors count, total ≤ root cap; (c) strict-subset vs parentScope: derived subset `⊊ parentScope`, object-identical members, write-free in Mode A; (d) classification-leak: a sub-agent returning a classification-shaped result → `tool_result_reject`; (e) BOTH failure boundaries: a sub-agent crashing inside `tool.invoke` AND one crashing outside it both → `subagent_error` + target `coverage_gap` + parent continues to floor + cleanup.

## Goal

Prove the agentic pivot preserves every CLAUDE.md invariant, mechanically, against the fixture — before the phase is considered shippable. This gate is the parity-and-trust bar: it asserts the loop produces real findings, the floor stays the sole classifier, both boundaries (failure + result-reject) fire, the ledger catches early termination, cleanup roundtrips across both write paths, and `--no-ai` still works.

## What lands

- Fixture-gate extensions covering all 7 Verification gates.
- Cut 1 ships gates 1–5 + 7 (read-only); Cut 3 adds gate 6 (writes).
- A deterministic AI-driver stub so the loop is reproducible in CI.

## Done when

Cut 1: gates 1–5 + 7 pass (read-only agentic flow proven trust-preserving). Cut 3: gate 6 added and passing (write-then-cleanup roundtrip across both paths).

## Guardrails

- Per Phase 2 step 01 preventer 8: paired with a representative dev/sandbox-project gate (or recorded-from-real snapshot), not fixture-only.
- Do NOT loosen any assertion to make the gate pass — the gate is the contract.
- Determinism gate uses a stubbed driver; live-driver runs are a separate opt-in suite.

## References

- `PLAN.md §H` Step 41, `§K`, `§D`; Phase 1 step 19b + Phase 2 step 15 (gate patterns extended)
