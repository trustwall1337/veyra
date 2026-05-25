# Step 18b — Orchestrator: seven-layer routing + Pass-2 disposition module

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §1 architecture, §4.2 disposition rules 1–5, §12b mid-scan failure rule`
**Amends Phase 1 step:** 18
**Produces:** orchestrator wiring at `src/core/orchestrator/scan-orchestrator.ts` + Pass-2 module at `src/core/assertions/hypothesis-disposition.ts`
**Depends on:** 09b, 10b, 11b, 12b, 13b, 14b, 08c, 08d, 17c
**Executed by:** plain coding pass
**Verification:** layer-routing trace test; Pass-2 disposition unit tests (rules 1–5); context-request retry-cap test; `--no-ai` skip-path test; agent-crash isolation test

## Goal

Wire the seven-layer orchestrator (revision §1) and the Pass-2 hypothesis-disposition module. **Pass-2 lives in its own file** (`src/core/assertions/hypothesis-disposition.ts`) owned by the orchestrator layer — not inline in the orchestrator file. This keeps the routing code thin and the disposition rules independently testable.

## What lands

- `src/core/orchestrator/scan-orchestrator.ts` — routes layers 1 → 1b → 1c → 2 → 3 (with `ContextRequest` retry loop, hard cap 2) → 4. Calls into the Pass-2 module after Pass-1 finishes. Per-agent try-boundary preserved from step 18.
- `src/core/assertions/hypothesis-disposition.ts` — implements revision §4.2 rules 1–5:
  - Rule 1: hypothesis matches a Pass-1 Finding → attach to `Finding.supporting_hypothesis_refs`; log `[attached_to_finding: <id>]` to `assertions.json`.
  - Rule 2: hypothesis's `proposed_control_id` has a Finding but evidence shape doesn't match → log `[predicate_contradicted]` to `assertions.json`. **No AIConcern emitted.**
  - Rule 3: no Finding + `requires_context` set → emit `ContextRequest`; orchestrator retries; on rejection or retry exhaustion, fall through to rule 4.
  - Rule 4: no Finding + no context request (or exhausted) → emit `AIConcern(category='no_predicate_fired' | 'insufficient_facts')`.
  - Rule 5: `proposed_finding_type === 'informational'` → emit `AIConcern(category='no_predicate_fired')`.
- Layer skip-paths: `--no-ai` → orchestrator does not invoke layers 1b, 3, or 5. Layer 1c composer runs with inventory only.
- Mid-scan failure: AI call failure or schema-violation discard → log to `scan-actions.log`, skip the affected batch, continue scan. Predicate failures isolate per agent via try-boundary.

## Done when

- Layer-routing trace test: orchestrator emits a trace artifact (`scan-trace.json`, debug-only) showing the exact layer order `1 → 1b → 1c → 2 → 3 → 4`.
- Pass-2 unit tests for each rule 1–5, each rule independently testable because `hypothesis-disposition.ts` is its own module.
- Context-request retry-cap test: 3rd retry → `ContextPolicyError.kind = 'retry_cap_exhausted'`; hypothesis falls through to rule 4.
- `--no-ai` skip-path test: assert no AI agent's `run()` is invoked; `ai-concerns.json` is empty; report still renders.
- Agent-crash isolation test: throw inside one Pass-1 predicate → other predicates still emit findings; the crashing one logs `agent_error` and the affected control gets `coverage_gap`.

## Guardrails

- **Constraint 7 enforced by Pass-2 ownership:** disposition module is the sole emitter of `AIConcern`. No agent emits AIConcerns directly.
- Per `REVISION_AI_SHAPE §4.1`: Pass-1 predicates receive `ScanFact[]` + `DeclaredContext` only. Pass-2 receives Findings + Hypotheses. The split is enforced by function signatures, not convention.
- Per `FPP §2A`: orchestrator iterates registered agents from the service registry, not via a `switch (agent_id)`. Adding an agent is one registration entry.
- Per `CLAUDE.md §Composability`: orchestrator is the only thing that calls multiple agents. Agents do not import each other.
- `assertions.json` is the audit spine for the disposition pass. Every hypothesis has exactly one recorded outcome.

## References

- `REVISION_AI_SHAPE.md` §1 (seven-layer architecture), §4.2 (disposition rules), §12b (mid-scan failure)
- `phase-1/steps/18-orchestrator-wiring-and-failure-isolation.md` (original — was not done; this amendment supersedes it)
- 08c (context-policy gate, called by retry loop), 08d (AI Inference Agent), 14b (evidence-report consumer)
