# Step 08d — AI Inference Agent

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §3.2, §7.2, §12 ordering, §12b opt-in, §14 Q4 (hypothesis budget)`
**Amends Phase 1 step:** none — new step file
**Produces:** agent at `src/agents/ai-inference/`
**Depends on:** 02c, 02d, 08b, 08c, 17c
**Executed by:** `/new-agent` skill
**Verification:** hypothesis-citation invariant; budget enforcement (cap 100, `--ai-hypothesis-budget` override); context-request emission to `ContextPolicyEvaluator`; schema-violation retry path (2 retries, then discard); `--no-ai` bypass

## Goal

The middle AI layer. Reads sanitized facts + declared context, produces `Hypothesis[]` (never Findings, never AIConcerns). Optionally emits `ContextRequest`s for more facts. AI is the inference engine here; classification stays deterministic downstream.

## What lands

- `src/agents/ai-inference/agent.ts`:
  - Reads `scan-facts.json` + `declared-context.json` (sanitized via 02c on entry to prompt construction).
  - Calls `AiProvider.complete()` with a structured-output schema for `Hypothesis[]`.
  - Writes `hypotheses.json`. Each hypothesis cites at least one `fact_id` from `scan-facts.json` in `evidence_refs`.
  - Emits `context-requests.json` when a hypothesis needs more facts to firm up. Routes through 08c `ContextPolicyEvaluator` (the orchestrator at 18b owns the retry loop).
  - Honours hypothesis budget: default 100, configurable via `--ai-hypothesis-budget`. When the budget is exhausted, the agent stops emitting and logs `budget_exhausted` to `scan-actions.log`.
  - Schema-violation retry: 2 retries with stricter schema-violation-correction prompt, then discard the batch and log.

## Done when

- Hypothesis-citation invariant test: every `hypothesis.evidence_refs[].fact_id` resolves in `scan-facts.json`. Hypotheses with empty `evidence_refs` are rejected at construction.
- Budget test: cap=5, feed input expected to produce >5 hypotheses → exactly 5 emitted, log shows `budget_exhausted`.
- Context-request test: hypothesis emits `requires_context.kind = 'read_file'`; orchestrator routes through 08c; on grant, agent re-runs with new facts.
- `--no-ai` test: agent is skipped entirely. Import-graph asserts no Anthropic SDK import path is reached.
- Schema-violation: deliberately violate → 2 retries with correction prompt → discard batch on 3rd failure, scan continues.
- Constraint 7 enforced: agent never emits a Finding (type system prevents it; runtime test confirms `hypotheses.json` schema).
- Every output has `confidence` + `uncertainty_notes` + `model_id` + `prompt_fingerprint_sha256`.

## Guardrails

- **Constraint 7:** AI output is `Hypothesis`, never `Finding`. Type signature of `agent.run()` returns `Promise<AgentResult<HypothesisOutput>>` where `HypothesisOutput.findings` is always empty.
- **Constraint 5:** agent never calls `ContextPolicyEvaluator` directly. It emits `ContextRequest`s into an artifact; the orchestrator (18b) routes them.
- **Constraint 8:** agent never writes to `inventory-bootstrap.json` or `declared-context.json`.
- Per `REVISION_AI_SHAPE §12b`: when AI is not configured (no env var or `--no-ai`), this agent is not constructed at all.
- Per `FPP §2A`: agent uses `AiProvider` interface, not the Anthropic SDK directly. Swapping providers in Phase 2 (OpenAI) requires no edits here.

## References

- `REVISION_AI_SHAPE.md` §3.2, §7.2, §12b
- 02c (`AiProvider` interface, sanitization)
- 02d (Anthropic adapter, called through 02c)
- 08c (`ContextPolicyEvaluator`)
- 17c (`declared-context.json` source)
