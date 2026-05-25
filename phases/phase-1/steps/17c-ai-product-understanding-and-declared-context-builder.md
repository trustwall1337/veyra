# Step 17c — AI Product-Understanding agent + `declared-context-builder` composer

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §1 layers 1b + 1c, §7.1 composer ownership, §12b opt-in matrix`
**Amends Phase 1 step:** 17 (sibling of 17b)
**Produces:** AI agent at `src/agents/ai-product-understanding/` + deterministic composer at `src/core/declared-context/`
**Depends on:** 02c, 02d, 17b
**Executed by:** `/new-agent` skill + plain coding pass for the composer
**Verification:** AI agent test with stub AiProvider produces `ai-declared-intent.json` only; composer rejects cross-field writes; `--no-ai` test produces `declared-context.json` from inventory alone

## Goal

Land the two missing pieces of layer 1: the AI agent that infers `declared_intent` from the bootstrap inventory, and the deterministic composer that produces the final `declared-context.json` with field-by-owner enforcement.

## What lands

- `src/agents/ai-product-understanding/agent.ts`:
  - Reads `inventory-bootstrap.json` (read-only).
  - Sanitizes input via 02c helpers (`SanitizedMessage` brand enforced at the call site).
  - Calls `AiProvider.complete()` with a structured-output schema for `declared_intent`.
  - Writes `ai-declared-intent.json` only. Never touches `inventory-bootstrap.json` or `declared-context.json`.
  - Output carries `confidence` + `uncertainty_notes` + `model_id` + `prompt_fingerprint_sha256` per field.
- `src/core/declared-context/builder.ts`:
  - Deterministic composer. Sole writer of `declared-context.json`.
  - Reads `inventory-bootstrap.json` (always) and `ai-declared-intent.json` (when present).
  - **Field-by-owner enforcement:** `declared-context.json.observed_evidence` copied verbatim from inventory; composer rejects any input from AI sources. `declared-context.json.declared_intent` copied from AI artifact; composer rejects any input from inventory.
  - `declared-context.json.sources` aggregates both source artifacts' fingerprints.

## Done when

- AI agent: produces `ai-declared-intent.json` when AI is opted-in. When `--no-ai` is set, the agent is skipped entirely (import-graph test asserts no Anthropic SDK import path is reached).
- Composer: produces `declared-context.json` in both modes. `--no-ai` produces an artifact where `declared_intent` falls back to the inventory's filename-derived hints (still deterministic) or to Lovable `send_message` raw responses when MCP is enabled.
- Field-ownership test: feed a malformed AI artifact that tries to set `observed_evidence` → composer rejects with explicit error.
- Field-ownership test: feed a malformed inventory artifact that tries to set `declared_intent` → composer rejects.

## Guardrails

- **Constraint 8 (AI never populates `observed_evidence`)** enforced by the composer's field-by-owner rule.
- Per `REVISION_AI_SHAPE §7.1`: composer is the sole writer of `declared-context.json`. Neither agent writes the final artifact directly.
- AI agent uses `AiProvider` interface from 02c — not the Anthropic SDK directly. Provider-agnostic by construction.
- Per `FPP §2A`: composer reads from configured artifact paths via the artifact store; no hardcoded file names in shared code. Adding a future inference source (e.g. AI-Cursor-context) = new input path + composer update; the composer's owner-field map is the registry.

## References

- `REVISION_AI_SHAPE.md` §1, §7.1, §12b
- 17b (deterministic Bootstrap Inventory — the other half of the split)
- 02c (sanitization helpers, `SanitizedMessage` brand)
- 02d (Anthropic adapter — used through 02c's interface)
