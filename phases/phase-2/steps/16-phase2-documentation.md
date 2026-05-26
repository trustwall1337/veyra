# Step 16 — Phase 2 documentation

**Status:** done (2026-05-26)
**Maps to:** `PHASE_2_PLAN §7 Task 12`, §13 migration
**Produces:** docs (`docs/active-validation.md`, `docs/synthetic-data-and-cleanup.md`, `docs/ai-explanations.md`, `docs/approval-flow.md`) + update to `PHASE_1_PLAN.md §3 Step 4 "AI Security Reasoning — deferred to Phase 2"`
**Depends on:** 15
**Executed by:** plain coding pass (+ `output-language-lint` on every doc)
**Verification:** `output-language-lint` zero hits on all four docs; `PHASE_1_PLAN §3 Step 4 "AI Security Reasoning — deferred to Phase 2"` now references `PHASE_2_PLAN §10`

## Goal

Ship the user-facing Phase 2 documentation. Reflects actual CLI flags, actual sandbox behavior, actual AI integration, actual approval flow. Last step because docs reference everything else.

## What lands

- `docs/active-validation.md` — what active validation is, what `proven_denial` and `proven_allowed` actually mean, what the report renders, what `proven_in_sandbox` does NOT claim.
- `docs/synthetic-data-and-cleanup.md` — synthetic data namespace, cleanup verification, what happens on cleanup failure, manual cleanup procedure if a scan crashes catastrophically.
- `docs/ai-explanations.md` — what AI is used for, what AI is NOT used for, sanitization, confidence labelling, model rollforward and version recording, cache TTL options.
- `docs/approval-flow.md` — Mode B approval requirements (interactive + CI), approval-file format, scope binding, single-use enforcement.
- Update `PHASE_1_PLAN.md §3 Step 4 "AI Security Reasoning — deferred to Phase 2"` and the alignment header so the AI-deferred note references the Phase 2 step files concretely (not just `PHASE_2_PLAN §10`).
- Update `README.md` to link to the Phase 2 docs as the entry point for Mode B usage.

## Done when

- Four docs exist and reference real CLI flags, real connector tool names, real report sections.
- `output-language-lint` subagent clean across all four files.
- Each doc names the `PHASE_2_PLAN.md` section it derives from.
- `PHASE_1_PLAN.md §3 Step 4` and the alignment header link to `phases/phase-2/steps/09-ai-explainer-agent.md` for the implementation.
- README updated.

## Guardrails

- Use only `§9` allowed-claims vocabulary (Phase 1 + Phase 2 additions). Never "secure," "safe," "compliant." `proven_in_sandbox` is a bounded claim about a specific synthetic scenario at a specific moment.
- Be explicit about non-goals: docs name the `§6.2` + `FPP §18` lists. Users should not be surprised that Veyra Phase 2 doesn't do production active validation, autonomous remediation, AI classification, brute force testing, etc.
- Be explicit about limits: AI explanations are suggestions; cleanup proof is bookkeeping, not audit; `proven_denial` is bounded; outcomes can drift across runs against a live sandbox.
- Do not document any feature that hasn't shipped. If step 11 didn't land the signed-approval-file reader, `approval-flow.md` either doesn't ship that section or says "not yet implemented."

## References

- `PHASE_2_PLAN.md` §6.1 (Required docs list), §9 (non-claims), §10 (AI discipline), §11 (trust model), §13 (migration)
- Phase 1 step 20 (Phase 1 docs — same shape and discipline)
- Phase 1 step 03 / step 11 (CLI flags this doc set references)
