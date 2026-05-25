# Step 13b — Reporter three-tier rendering

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §11`; `PHASE_2_PLAN §11 reduction 4 confirmation`; revision §14 Q6
**Amends Phase 1 step:** 13
**Produces:** reporter extension at `src/reporters/markdown/sections/` and `src/reporters/markdown/evidence/`
**Depends on:** 02b, 08b, 08d, 14b
**Executed by:** plain coding pass (+ `output-language-lint` on every new heading and string)
**Verification:** snapshot tests per tier; `output-language-lint` zero hits across all three; threshold flag works correctly; `--no-ai` test (entire AIConcerns section omitted)

## Goal

Add the three-tier report structure: Findings (deterministic), AIConcerns (AI-suggested), Active outcomes (Phase 2 placeholder). AIConcern visibility is governed by `--ai-concern-threshold low|medium|high` (default `medium`) — single flag, no separate hide-low control.

## What lands

- `src/reporters/markdown/sections/findings.ts` — tier 1, unchanged from step 13.
- `src/reporters/markdown/sections/ai-concerns.ts` — tier 2, new. Renders `ai-concerns.json` entries at or above `--ai-concern-threshold` under "AI-suggested areas for human review." Entries below threshold are recorded in the artifact but not rendered.
- `src/reporters/markdown/sections/active-outcomes.ts` — tier 3, Phase 1 placeholder (the active-outcomes section header is reserved; Phase 2 fills it).
- `src/reporters/markdown/evidence/static-code.ts`, `mcp-context.ts`, `scanner.ts` — unchanged from step 13 plan.
- `src/reporters/markdown/sections/sources.ts` — updated to record AI usage: which provider, which model, cache hit ratio, count of AI calls, `--no-ai` note when applicable.
- `src/reporters/markdown/strings.ts` — adds the three-tier heading strings; passes `output-language-lint`.

## Done when

- Snapshot test per tier passes against the fixture.
- `output-language-lint` returns zero hits across all rendered strings and tier headings.
- `--ai-concern-threshold low|medium|high` test: setting to `high` renders only high-confidence entries; `low` renders everything; `medium` (default) renders medium + high.
- `--no-ai` test: tier 2 (AIConcerns) is omitted entirely; Sources section includes "AI was disabled for this scan; AIConcerns not produced."
- Per-`EvidenceKind` renderer exhaustiveness test fails the build if a new kind is added without a renderer.

## Guardrails

- Per `REVISION_AI_SHAPE §11`: three tiers, distinct headings, no mixing. AIConcerns never appear under "Findings."
- Single threshold flag — `--hide-low-confidence-concerns` is NOT introduced (per the post-review correction).
- Per `output-language-lint`: forbidden words ("secure," "safe," "compliant") banned. Heading strings sanity-checked.
- Per `FPP §2A`: renderers register by `EvidenceKind` discriminator, never by provider name. Adding a new connector or scanner does not require editing any reporter.

## References

- `REVISION_AI_SHAPE.md` §11 user-facing tiers
- `phase-1/steps/13-reporter-markdown-and-json.md` (original — was not done; this amendment supersedes it)
- 14b (evidence-report output consumed here)
