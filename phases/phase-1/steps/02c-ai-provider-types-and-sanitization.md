# Step 02c — AiProvider types + sanitization helpers (no SDK imports)

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §5.2 sanitization order, §5.3 prompt-injection guard, §7.2`; `PHASE_2_PLAN §10.3`
**Amends Phase 1 step:** none — new step file
**Produces:** types + helpers under `src/ai/` (no SDK imports)
**Depends on:** 02b
**Executed by:** plain coding pass
**Verification:** sanitization round-trip tests (JWT, service-role key, email, UUID, high-entropy patterns — none survive); brand-type assignment tests; no-SDK-imports guardrail

## Goal

Land the provider-agnostic AI types and the sanitization helpers that everything else depends on. **No SDK imports here** — the Anthropic adapter lives in 02d. This split lets the policy modules (08c) depend on sanitization without dragging in `@anthropic-ai/sdk`.

## What lands

- `src/ai/types.ts` — `AiProvider` interface (`complete(request) → Promise<Result<AiResponse, AiProviderError>>`), `AiRequest`, `AiResponse`, `AiProviderError`.
- `src/ai/sanitization.ts`:
  - `redactSecrets(input: string): SanitizedMessage` — reuses Gitleaks regex set + custom patterns from `src/scanners/gitleaks/`. Strips JWT (`eyJ...`), Supabase service-role keys, AWS keys, OpenAI keys, generic high-entropy strings, email addresses, UUID patterns.
  - `stripRawData(record: unknown): unknown` — strips known-PII shape from structured input.
  - `wrapAsObservedContent(content: SanitizedMessage, fact_id: string): string` — wraps with `<observed_content fact_id="..." sanitized="true">...</observed_content>` delimiters per revision §5.3 prompt-injection guard.
- `src/ai/prompt-injection-detector.ts` — heuristic detector for AI output that appears to follow instructions found inside `<observed_content>` (e.g. asks for raw secrets, asks to disable sanitization, drops the system prompt). Returns boolean.

## Done when

- Sanitization unit tests: feed each forbidden pattern → none survives a round-trip.
- `SanitizedMessage` brand prevents accidentally passing un-redacted strings into `AiRequest` construction (compile-time error if you try).
- No file in `src/ai/types.ts` or `src/ai/sanitization.ts` imports from any SDK package. Verified by an import-graph test.
- `pnpm typecheck` green.

## Guardrails

- **No SDK imports.** This step is provider-agnostic. The Anthropic SDK lives in 02d only.
- Sanitization helpers are pure functions — no I/O, no state.
- Per revision §5.2: sanitization runs **twice** (before-store and before-AI). Both passes use these helpers.
- Per revision §5.3: prompt-injection detection is heuristic, not perfect. False positives are acceptable; false negatives fail-closed (caller discards the AI batch).

## References

- `REVISION_AI_SHAPE.md` §5.2, §5.3, §7.2
- `PHASE_2_PLAN.md` §10.3
- Phase 1 step 05 (Gitleaks regex set — reused for sanitization)
