# Step 09 — `ai-explainer` agent

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 7`, §4.10, §10.1, §10.5
**Produces:** agent (`src/agents/ai-explainer/`)
**Depends on:** 04
**Executed by:** `/new-agent` skill (+ `output-language-lint` on prompt templates + sample outputs)
**Verification:** every output carries `confidence` + `uncertainty_notes`; classification fields are NEVER set by this agent; `--no-ai` produces no `ai-enrichments.json` and the orchestrator still finishes

## Goal

Per-`EvidenceKind` enrichment. Takes every finding produced by upstream agents and writes a plain-language explanation, refined suggested tests, and control-card narrative. AI input is sanitized. AI never classifies, never decides.

## What lands

- `src/agents/ai-explainer/agent.ts` — implements `VeyraAgent`. Iterates findings; for each, sanitizes inputs via step 04's helpers; calls the registered `AiProvider`; structured-output schema enforces `{ explanation, suggested_tests_refined, control_card_narrative, confidence, uncertainty_notes }`.
- `src/agents/ai-explainer/prompts/` — one file per evidence-kind (per `FPP §2A` rule 6: per-`EvidenceKind`, not per-connector):
  - `static-code-prompt.ts`
  - `mcp-context-prompt.ts`
  - `scanner-prompt.ts`
  - `active-validation-prompt.ts`
  - `cleanup-proof-prompt.ts`
- `src/agents/ai-explainer/schemas/` — zod schemas for the structured outputs.
- Output artifact: `ai-enrichments.json` keyed by `finding_id`.

## Done when

- Every output carries `confidence: 'low' | 'medium' | 'high'` and `uncertainty_notes` (assertion test).
- Agent's emitted findings have NO `finding_type`, `evidence_strength`, `review_action`, `blast_radius`, or `readiness_status` writes (assertion test reads back the artifact and confirms only `explanation` / `suggested_tests_refined` / `control_card_narrative` fields are added).
- `--no-ai` test: no `ai-enrichments.json` written; orchestrator completes; report renders an empty AI section.
- `output-language-lint` clean on all prompt templates and on a sample of generated outputs (sampled in tests by recording fixtures).
- Sanitization round-trip test: feed a synthetic finding with embedded JWT / email / Gitleaks pattern → none survive into the prompt fingerprint or the artifact.

## Guardrails

- Per `§10.2` (verbatim): "AI never classifies. AI never decides what to fix."
- Per `§10.5`: every AI output has `confidence` and `uncertainty_notes`. Low-confidence outputs render under a distinct subheading in step 12's reporter.
- Per `§10.3`: all input sanitized BEFORE prompt construction. Use the branded `SanitizedMessage` type from step 04.
- Per `§4.10`: disabled when `--no-ai`. The orchestrator must not require this agent to complete.
- Per `FPP §2A` rule 6: prompts are per-`EvidenceKind`, not per-connector. A new connector (Firebase, GitHub, etc.) does NOT require a new prompt template here.
- Per `§10.6`: every output records the model id used. Model rollforward must be auditable.

## References

- `PHASE_2_PLAN.md` §4.10 (agent controls), §10 (full AI discipline)
- Step 04 `AiProvider` interface + sanitization
- `.claude/skills/new-agent/SKILL.md`, `.claude/agents/output-language-lint.md`
