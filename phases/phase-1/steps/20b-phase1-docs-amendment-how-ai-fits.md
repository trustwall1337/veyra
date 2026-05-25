# Step 20b — Phase 1 docs amendment: "How AI fits"

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §10 step 20 row, §15 verdict`
**Amends Phase 1 step:** 20
**Produces:** docs amendments — `README.md` section + `docs/how-ai-fits.md`
**Depends on:** 19b
**Executed by:** plain coding pass (+ `output-language-lint` on every new string)
**Verification:** `output-language-lint` zero hits; doc cross-references resolve

## Goal

Document the AI-first reshape for users (`README.md`) and contributors (`docs/how-ai-fits.md`). Plain language. New readers should be able to predict, from these docs alone, which artifact a given agent emits.

## What lands

- `README.md` — new section "How AI fits in a Veyra scan" with the seven-layer summary (observation → inference → assertion → planning → compilation → execution), the four artifact types in one sentence each, the `--no-ai` opt-out, the three-tier report.
- `docs/how-ai-fits.md` — fuller treatment with:
  - The seven layers with one-line descriptions.
  - The four artifact types (`ScanFact`, `Hypothesis`, `Finding`, `AIConcern`) with producer + consumer + example for each.
  - The §12b opt-in matrix (env var × flag × `--no-ai`) reproduced.
  - The ten trust-model constraints from revision §8.
  - The mandatory baseline rule (revision §2): AI never deletes from the floor.
- Update the existing `docs/phase-1.md` to link to `how-ai-fits.md`.
- Update `phase-1/steps/README.md` index entries 02b/02c/02d/.../20b so the post-revision step set is discoverable.

## Done when

- `output-language-lint` clean on every new and updated string. No "secure / safe / compliant."
- New reader can predict: "given inventory-bootstrap.json, who writes declared-context.json?" → "the deterministic declared-context-builder composer in 17c, after merging AI's ai-declared-intent.json contribution."
- Cross-references resolve: every `phase-1/steps/Nb-*.md` mentioned in the docs exists.
- `FPP §18` non-goal list is reaffirmed (no chat interface, no autonomous remediation, etc.).

## Guardrails

- Per `output-language-lint`: forbidden vocabulary banned everywhere, including the headings.
- Per `FPP §2A`: docs do NOT reference provider names as universal truths — "Anthropic" appears as "the default provider for Phase 1," not as a hardcoded assumption.
- Per `CLAUDE.md` writing discipline: plain language, no jargon when a sentence works without it.
- Documentation describes what the product does, not what we want it to claim. No marketing language about "intelligence" or "smart."

## References

- `REVISION_AI_SHAPE.md` §10 step 20 row, §15 verdict, §12b opt-in matrix, §8 constraints
- `phase-1/steps/20-phase1-documentation.md` (original — was not done; this amendment supersedes it)
- 19b (the gate that proves the docs are accurate before they ship)
