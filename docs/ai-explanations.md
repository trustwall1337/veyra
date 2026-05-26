# AI explanations (advisory, never classifying)

Phase 2 introduces the `ai-explainer` agent (step 2.09): per-finding
plain-language explanations, refined suggested tests, and
control-card narrative. The agent is advisory — it NEVER decides
what to fix and NEVER classifies a finding.

## What AI does

- Reads each Phase 1 / Phase 2 finding, sanitizes the input via
  `redactSecrets`, calls the registered `AiProvider` with a
  structured-output schema.
- Returns:
  - `explanation` — plain-language description of why the control
    matters and what the finding observed.
  - `suggested_tests_refined` — list of negative tests the customer
    should add.
  - `control_card_narrative` — text the reporter renders under the
    control card.
  - `confidence` — one of `low | medium | high`.
  - `uncertainty_notes` — what the AI was uncertain about.

## What AI never does (per REVISION_AI_SHAPE §8 + §10.2)

- Never sets `finding_type`. (Only deterministic agents set this.)
- Never sets `evidence_strength`.
- Never sets `review_action`.
- Never sets `blast_radius`.
- Never sets `readiness_status`.
- Never invents new active tests. The catalog at
  `src/agents/sandbox-runner/test-catalog/` is checked-in code; the
  AI Security Planner is constrained to that set, and the compiler
  re-injects any omitted baselines.

## Opt-in matrix

AI is opt-in. The CLI's behavior:

- No env var, no flag → AI skipped silently (Findings-only report).
- `--ai-provider anthropic` set, `ANTHROPIC_API_KEY` set → AI opted-in
  with Anthropic.
- `--ai-provider openai` set, `OPENAI_API_KEY` set → AI opted-in
  with OpenAI (step 2.04).
- `--no-ai` is the hard override. Even when both a key and a
  provider are set, `--no-ai` skips the AI layer end-to-end.

The provider id flows through an opaque `ProviderId` brand (FPP
§2A). Adding a third provider (Gemini, Bedrock, local-llm) is a
single registration entry; no closed `'anthropic' | 'openai'`
union exists in shared types.

## Confidence threshold (visibility control)

`--ai-concern-threshold <low|medium|high>` controls which AI
suggestions render in the main report body. Entries below the
threshold are recorded in `ai-enrichments.json` for audit but
render under a clearly labelled "low-confidence" subhead.

Default threshold: `medium`. Setting `low` shows everything;
setting `high` shows only high-confidence entries. This is the
single visibility control — no separate hide-low flag.

## Audit

Every AI call records one entry to `scan-actions.log` (step 2.14)
with the model id, the SHA-256 prompt fingerprint, token usage,
and outcome. Raw prompt content NEVER appears in the log.

## Sanitization

Every input crossing into a prompt passes through
`redactSecrets()` (Phase 1 step 02c). The SanitizedMessage brand
enforces the boundary at the type level — a raw string cannot
reach an AI prompt; the compiler refuses the assignment.
