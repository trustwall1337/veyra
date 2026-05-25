# Step 18 — Orchestrator wiring + failure isolation

**Status:** done (2026-05-25)
**Maps to:** `PHASE_1_PLAN §7 Task 2 completion`, §4.0 architecture rules
**Produces:** `src/core/orchestrator/scan-orchestrator.ts` (complete)
**Depends on:** 08, 09, 10, 11, 12, 14, 17
**Executed by:** plain coding pass (+ `plan-adherence` subagent to verify no agent-to-agent imports)
**Verification:** integration test that throws inside one agent and asserts the rest still complete

## Goal

Finish the orchestrator skeleton from step 02. Topologically order agents by declared dependencies, run each in its own try-boundary, ensure one agent's crash never corrupts the artifact store or blocks independent agents.

## What lands

- `src/core/orchestrator/scan-orchestrator.ts` — full implementation:
  - Agent registry (list, not switch statement)
  - Topological sort over `AgentMetadata.dependsOn`
  - Per-agent try-boundary; throws emit `coverage_gap` finding + `agent-<id>.error.json` artifact
  - Deterministic artifact directory layout per scan id (append-only)
- `src/core/orchestrator/registry.ts` — central agent registration. Every agent from steps 08/09/10/11/12/14/17 is registered with metadata.
- Integration tests:
  - Happy path: all agents complete, artifact store has expected files
  - One agent throws: other agents complete, error artifact present, coverage_gap finding emitted
  - Missing upstream artifact: dependent agent emits `coverage_gap`, doesn't crash

## Done when

- All seven Phase 1 agents run in dependency order on the fixture.
- Throwing inside any one agent leaves the rest intact.
- `plan-adherence` subagent confirms no `import` line in any agent points at a sibling agent (composability rule from §4.0).
- Artifact directory layout is the same across runs given the same input (determinism).
- `--fail-on-blocker` exit code from step 03 actually reflects orchestrator output now.

## Guardrails

- Per §4.0 (verbatim): "Agents do not call each other directly." Verified by `plan-adherence`.
- Per §4.0: "The orchestrator owns ordering, retries, and dependency wiring."
- No `switch (agentId)` in shared code. Registry is a list; agents are addressed by metadata.
- No hard-coded service names (`'lovable'`, `'supabase'`) in `tool-policy.ts` — service identity is a parameter.
- Artifact store is append-only per scan (one scan id → one subdirectory). Partial scans never overwrite prior ones.
- Stderr from scanner subprocesses is persisted to the artifact store alongside stdout (after secret-pattern check).

## References

- `PHASE_1_PLAN.md` §4.0 (Agent runtime architecture), §7 Task 2
- `CLAUDE.md` §Architecture
- `.claude/agents/plan-adherence.md`
