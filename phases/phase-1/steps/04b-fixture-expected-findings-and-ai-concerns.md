# Step 04b — Fixture amendment: `expected-findings.json` + `expected-ai-concerns.json`

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §9 step 04 row`
**Amends Phase 1 step:** 04
**Produces:** amended fixture at `examples/vulnerable-lovable-supabase/`
**Depends on:** 02b, 08b, 08d
**Executed by:** plain coding pass
**Verification:** integration assertion under `pnpm test`; `expected-ai-concerns.json` entries are EXPECTATION DESCRIPTORS (the `ExpectedAIConcern` shape), not actual `AIConcern` objects — the gate at 19b loads them as expectations against the AI-enabled scan's emitted AIConcerns

## Goal

Split the fixture's expectation artifact into two: `expected-findings.json` (deterministic baseline, immune to AI presence) and `expected-ai-concerns.json` (optional, surfaces when AI runs). The deterministic gate at 19b reads both. `--no-ai` runs are validated against `expected-findings.json` only.

## What lands

- `examples/vulnerable-lovable-supabase/expected-findings.json` — reshaped to reference `control_id`s and the new artifact-name `scan-facts.json` (no longer `scanner-findings.json`). Same control IDs as today.
- `examples/vulnerable-lovable-supabase/expected-ai-concerns.json` — new artifact. Lists AIConcerns the fixture is expected to surface when AI is enabled. Each entry: `{ control_id?, category, confidence, must_surface: boolean }`. `confidence: 'low'` entries are tolerated but not required (per revision §14 Q6 + Q8).
- `examples/vulnerable-lovable-supabase/expected-findings.test.ts` — rewritten to read both new artifacts and to drive the assertion-replay determinism test from 19b.

## Done when

- `expected-findings.json` references `scan-facts.json` shape, not the old `scanner-findings.json`.
- `expected-ai-concerns.json` validates against the `AIConcern` schema from 02b.
- `pnpm test` integration: `--no-ai` run satisfies `expected-findings.json` exactly. AI-enabled run satisfies both files (must_surface concerns present; low-confidence tolerated).
- Renaming a `control_id` requires touching both files in the same commit (cross-reference check).

## Guardrails

- Per revision §14 Q8 + constraint 10: `--no-ai` produces the same Findings as the AI-enabled run. The expected files must reflect this — never add `missing_evidence` entries that only appear under `--no-ai`.
- Hardcoded "secret" patterns in the fixture stay obviously fake (`sk_test_FAKE_DO_NOT_USE`, `eyJ...REDACT_ME`).
- Per `FPP §2A`: expectation files are keyed by `control_id`, not by free-form descriptions. Renaming a control_id requires updating both files plus `controls.ts`.

## References

- `REVISION_AI_SHAPE.md` §9 step 04 row, §11 user-facing report tiers
- `phase-1/steps/04-vulnerable-fixture.md` (original — was not done; this amendment supersedes it)
- 02b (`AIConcern` type), 08b (`scan-facts.json` shape), 08d (AI Inference output)
