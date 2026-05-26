# Step 04 — OpenAI fallback adapter

> **Narrowed by the AI-first revision (2026-05-24).** The `AiProvider`
> interface and the Anthropic adapter moved into Phase 1 revision step files:
> see `phases/phase-1/steps/02c-ai-provider-types-and-sanitization.md`
> (provider-agnostic interface + sanitization helpers) and
> `phases/phase-1/steps/02d-anthropic-adapter.md` (default adapter).
> This step's scope is now ONLY the OpenAI fallback adapter implementing the
> already-shipped Phase 1 `AiProvider` interface.

**Status:** done (2026-05-26)
**Maps to:** `PHASE_2_PLAN §1.4` (OpenAI verified), `§10.6` (model choice), `§7 Task 3 (part A — narrowed)`
**Produces:** `src/ai/openai.ts` (the only file that imports `openai` SDK)
**Depends on:** Phase 1 02c (`AiProvider` interface + sanitization helpers)
**Executed by:** plain coding pass (+ `output-language-lint` on any prompt-template strings)
**Verification:** same sanitization + structured-output tests as Phase 1 02d, replayed against this adapter

## Goal

Implement the `AiProvider` interface (already shipped in Phase 1 step 02c) using the `openai` SDK. Same `Result<AiResponse, AiProviderError>` shape as Anthropic. One provider per scan; this adapter is selected via `--ai-provider openai`.

## What lands

- `src/ai/openai.ts` — wraps `openai` SDK. **The only file in the repo that imports `openai`.**
  - Default model: `gpt-4o-mini` for cost-equivalence with `claude-sonnet-4-6`.
  - Upgrade model: `gpt-4o` for quality-equivalence, selectable via `--ai-model`.
  - Structured outputs via `response_format: { type: 'json_schema', strict: true }` (token-level grammar enforcement equivalent to Anthropic's `output_config.format`).
  - Same `AiProvider.complete()` contract from 02c. Same `Result<AiResponse, AiProviderError>` shape. Same `scan-actions.log` entry per call.
  - OpenAI does not have a Phase-1-equivalent provider-side prompt cache; sets `cache_read_input_tokens: 0` and notes that limitation in `uncertainty_notes`. Cost-control mitigation is on the caller side (smaller system prompts).
  - Reads `OPENAI_API_KEY` from env var only — never from argv.

## Done when

- Adapter passes the same test suite Phase 1 02d runs against the Anthropic adapter (sanitization round-trip, schema-violation rejection, `--no-ai` short-circuit before SDK import, scan-actions.log entry on every call).
- `--ai-provider openai` selects this adapter at runtime (verified by Phase 1 03b CLI tests).
- Identical `Result<AiEnrichment, AiProviderError>` shape returned by both adapters on the same input — call-site code does not know which provider answered.
- No file outside `src/ai/openai.ts` imports `openai`.

## Guardrails

- **The `AiProvider` interface lives in Phase 1 step 02c — do NOT redefine it here.** This step only adds an implementation behind the existing interface. If you find yourself extending `AiProvider`, that's a 02c amendment, not a 04 amendment.
- Per `PHASE_2_PLAN §10.2`: no tool-use loops. Plain chat completions with structured output only.
- Per `PHASE_2_PLAN §10.6`: model id recorded on every output; OpenAI model versions roll forward independently of the codebase.
- Per `FPP §2A`: provider id is opaque (`ConnectorId`-shaped). No `'openai'` string union in shared types. Adding a third provider (Gemini, Mistral, local model) = new file under `src/ai/`, new registration entry; no edits here.
- API key accepted via env var only. Never on argv. Never logged. Args fingerprints in `scan-actions.log` are SHA-256.

## References

- `PHASE_2_PLAN.md` §1.4 (OpenAI verified capabilities), §10 (AI integration discipline)
- `phases/phase-1/steps/02c-ai-provider-types-and-sanitization.md` (interface this implements)
- `phases/phase-1/steps/02d-anthropic-adapter.md` (sibling adapter using the same interface)
- OpenAI structured outputs guide
