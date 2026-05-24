# Step 05 — OpenAI fallback adapter

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 3` (part B), §1.4, §10.6
**Produces:** `src/ai/openai.ts` behind the same `AiProvider` interface from step 04
**Depends on:** 04
**Executed by:** plain coding pass
**Verification:** same sanitization + structured-output tests as step 04; provider selectable via `--ai-provider openai` once step 11 lands

## Goal

Second `AiProvider` implementation. OpenAI's `response_format: { type: 'json_schema', strict: true }` gives token-level grammar enforcement equivalent to Anthropic's structured outputs. Phase 2 ships both adapters; one provider per scan (per `§1.4`).

## What lands

- `src/ai/openai.ts` — wraps the `openai` SDK. Default model `gpt-4o-mini` for cost-equivalence with `claude-sonnet-4-6`; `gpt-4o` for quality-equivalence (selectable via `--ai-model`).
- Same `AiProvider` contract as the Anthropic adapter — `Result<AiResponse, AiProviderError>` shape identical.
- OpenAI does not have provider-side prompt caching with the same shape as Anthropic. The adapter sets `cache_read_input_tokens: 0` and notes in `uncertainty_notes` that caching isn't equivalent.
- Same `scan-actions.log` entries as step 04.

## Done when

- Adapter passes the same test suite step 04 runs: sanitization round-trip, schema-violation rejection, `--no-ai` short-circuit before import.
- `--ai-provider openai` selects this adapter at runtime (verified in step 11 CLI tests).
- Identical `Result<AiEnrichment, AiProviderError>` shape returned from both adapters on the same input.

## Guardrails

- Per `§10.2`: no tool-use loops. Chat completions with structured output only.
- API key accepted via env var only (`OPENAI_API_KEY`). Never on argv.
- Do not introduce abstractions that only OpenAI needs into `AiProvider` shared types. OpenAI-specific config lives inside this file.
- Per `§10.6`: model id is recorded on every output. OpenAI model versions roll forward — the report shows the version that was used at scan time.

## References

- `PHASE_2_PLAN.md` §1.4 (OpenAI permitted/forbidden), §10.6 (model choice)
- OpenAI structured outputs (`response_format: { type: 'json_schema', strict: true }`)
- Step 04 `AiProvider` interface
