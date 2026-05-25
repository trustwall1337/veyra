# Step 02d — Anthropic adapter

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §7.2, §12 ordering, §12b opt-in matrix`; `PHASE_2_PLAN §1.3, §10.4, §10.6`
**Amends Phase 1 step:** none — new step file
**Produces:** `src/ai/anthropic.ts` — the only file in the repo that imports `@anthropic-ai/sdk`
**Depends on:** 02c
**Executed by:** plain coding pass (+ `output-language-lint` on any prompt-template strings introduced here)
**Verification:** structured-output schema-violation rejected; prompt-cache hit-ratio test; `--no-ai` short-circuits before `@anthropic-ai/sdk` import (import-graph test); `scan-actions.log` entry on every call

## Goal

Implement the `AiProvider` interface from 02c using `@anthropic-ai/sdk`. Provider-native structured outputs via `output_config.format`. Prompt caching on system + control-catalog blocks. Every call audit-logged. **This is the only file that imports the Anthropic SDK** — all other Veyra code talks to AI through the `AiProvider` interface.

## What lands

- `src/ai/anthropic.ts`:
  - Wraps `@anthropic-ai/sdk` client.
  - Default model: `claude-sonnet-4-6`. Configurable via `AiRequest.model_id`.
  - Structured outputs via `tools` + forced `tool_choice`. Define one tool `emit_structured_output` whose `input_schema` is the caller-provided JSON schema (zod 4 → JSON schema via `z.toJSONSchema(...)` on the call site, or hand-rolled JSON schema). Set `tool_choice: { type: 'tool', name: 'emit_structured_output' }` so Claude must return a `tool_use` block. The adapter then extracts the tool input, validates it locally against the same schema, and returns `parsed_output`. Schema violation returns `Result.err(AiProviderError { kind: 'schema_violation' })`. Anthropic-side shaping does not replace Veyra-side validation.
  - `cache_control: { type: 'ephemeral' }` on the system prompt + control-catalog blocks. TTL configurable per request.
  - Returns `cache_read_input_tokens` and `cache_creation_input_tokens` in `AiResponse` for observability.
  - Writes a `scan-actions.log` entry per call: `{ action_id: 'ai_call', model_id, prompt_fingerprint_sha256, input_tokens, output_tokens, cache_hit_ratio, duration_ms, outcome }`.
  - Reads `ANTHROPIC_API_KEY` from env var only — never from argv.

## Done when

- Structured-output unit test: feed a schema, ask the adapter to honour it, get back schema-valid JSON; deliberately violate → adapter returns `Result.err(SchemaViolationError)`.
- Prompt-caching test: same system + catalog two calls in a row → second call's `cache_read_input_tokens > 0`.
- `--no-ai` flag → the adapter is not constructed at all (import-graph asserts this).
- Missing `ANTHROPIC_API_KEY` env var when `--ai-provider anthropic` is set → CLI rejects at parse time (verified in 03b).
- `scan-actions.log` has one entry per call with non-empty fingerprint + token counts.

## Guardrails

- Per revision §10.2 (AI does NOT do): no tool-use loops, no chat-multi-turn for action execution. Single-call chat completions with structured output only.
- API key read from env var. Never logged. Never in `scan-actions.log`. Args fingerprints are SHA-256, never raw.
- Per `PHASE_2_PLAN §10.4`: prompt caching mandatory on system + catalog blocks.
- Per `PHASE_2_PLAN §10.6`: model_id recorded on every output. Model rollforward auditable.
- Adapter is the only Anthropic-aware file. Any other file that needs AI imports the `AiProvider` interface from 02c.

## References

- `REVISION_AI_SHAPE.md` §7.2, §12b
- `PHASE_2_PLAN.md` §1.3 (Anthropic verified capabilities), §10
- 02c `AiProvider` interface
- Anthropic docs: prompt caching, structured outputs
