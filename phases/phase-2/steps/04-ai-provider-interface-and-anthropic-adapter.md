# Step 04 — AI provider interface + Anthropic adapter

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 3` (part A), §10.3, §10.4, §10.6
**Produces:** connector-shaped: `src/ai/types.ts`, `src/ai/anthropic.ts`, `src/ai/sanitization.ts`
**Depends on:** 02
**Executed by:** plain coding pass (+ `output-language-lint` on prompt-template strings)
**Verification:** sanitization unit tests confirm no JWT/email/Gitleaks-pattern survives; structured-output schema violation rejected; `cache_control` set on system + control-catalog blocks; `scan-actions.log` entry on every call

## Goal

Land the `AiProvider` interface plus the Anthropic adapter (default per `§10.6`). Provider-native structured outputs only. Prompt caching enabled on system + control-catalog blocks. Sanitization required before any prompt is sent.

## What lands

- `src/ai/types.ts`:
  - `AiProvider` interface with `id: string`, `complete(request: AiRequest): Promise<Result<AiResponse, AiProviderError>>`
  - `AiRequest = { system: string; user_messages: SanitizedMessage[]; structured_output_schema: zod.ZodSchema; cache_control?: { ttl: 'ephemeral_5m' | 'ephemeral_1h' } }`
  - `AiResponse = { data: unknown (schema-validated), model_id, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, confidence: 'low' | 'medium' | 'high', uncertainty_notes }`
  - `SanitizedMessage = { role, content: string & { __brand: 'Sanitized' } }`
- `src/ai/sanitization.ts`:
  - `redactSecrets(input: string): SanitizedMessage` — reuses Gitleaks regex set from Phase 1 step 05; strips JWT (`eyJ...`), Supabase service-role keys, AWS keys, OpenAI keys, generic high-entropy strings, email addresses, UUID patterns.
  - `stripRawData(record: unknown): unknown` — for structured input (e.g. declared-context.json), redacts known-PII shape (emails, names, IDs in known-sensitive-table rows). Never sends row contents.
- `src/ai/anthropic.ts`:
  - Wraps `@anthropic-ai/sdk` client.
  - Default model: `claude-sonnet-4-6`.
  - Uses Anthropic's structured-outputs (`output_config.format`) for grammar-enforced JSON. Schema from request; provider compiles into a token-level grammar.
  - `cache_control: { type: 'ephemeral' }` on system prompt + control-catalog blocks per `§10.4`. TTL configurable via the request.
  - Returns `cache_read_input_tokens` / `cache_creation_input_tokens` in the response for observability.
  - Every call writes a `scan-actions.log` entry: `{ action_id: 'ai_call', model_id, prompt_fingerprint_sha256, input_tokens, output_tokens, cache_hit_ratio, duration_ms, outcome }`.

## Done when

- Sanitization unit tests pass: feed each forbidden pattern (JWT, service-role key, email, UUID, secret-like high-entropy string) → none survive a round-trip.
- Structured-output unit test: deliberately violate schema → adapter returns `Result.err(SchemaViolationError)`.
- Prompt-caching test: same system + catalog two calls in a row → second call shows `cache_read_input_tokens > 0`.
- `--no-ai` short-circuits BEFORE importing `@anthropic-ai/sdk` — verified by an import-graph test.
- `output-language-lint` clean on every prompt template in `src/ai/anthropic.ts`.

## Guardrails

- Per `PHASE_2_PLAN §10.2`: AI never classifies. The adapter returns `unknown` schema-validated data; the agent that called it never lets that data set `finding_type` / `evidence_strength` / `review_action` / `blast_radius` / `readiness_status`.
- Per `§10.3`: all input is sanitized BEFORE construction of `AiRequest`. The `SanitizedMessage` brand prevents accidentally passing unsanitized strings.
- Per `§10.2`: no tool-use loops, no agentic action-taking. Chat-completions with structured output only.
- API key accepted via env var only (e.g. `ANTHROPIC_API_KEY`). Never on argv. Never logged.
- Prompt fingerprints in `scan-actions.log` are SHA-256, not raw prompts — sanitization is best-effort, but the log treats every prompt as if it could contain unredacted content.

## References

- `PHASE_2_PLAN.md` §10 (AI integration discipline)
- Anthropic API: prompt caching, structured outputs, `claude-sonnet-4-6`
- `.claude/agents/output-language-lint.md`
- Phase 1 step 05 Gitleaks regex set (reused for sanitization)
