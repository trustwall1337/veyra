# Step 36 — Narrative author + claim-linter + deterministic renderer

**Status:** done (2026-05-28) — claim-record substrate + deterministic composer + linter + pure renderer + 4 templates landed; AI authoring slots over the same ClaimRecord[] surface in a follow-up
**Maps to:** `PLAN.md §G` (DEPRECATE ai-explainer), carries PLAN-v1 §D.A (claim-records → deterministic prose)
**Phase:** 3, Cut 2
**Produces:** `src/agents/narrative-author/` (emits `ClaimRecord[]` only, never free-form prose) + `src/agents/narrative-author/templates/` (one per `(claim_type, predicate_kind)`, `output-language-lint`-clean) + claim-linter + deterministic `narrative-renderer`; DEPRECATEs Phase 2 step 09 `ai-explainer`.
**Depends on:** 35
**Executed by:** plain coding pass + `output-language-lint` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) `narrative-author` emits structured `ClaimRecord[]` (claim_type, subject_id, predicate_output_id, supporting_artifact_refs, template_params) — never prose; (b) claim-linter checks: known claim_type; predicate_output_id resolves; subject_id resolves; supporting_artifact_refs non-empty + resolve; `(claim_type, predicate_kind)` has a registered template; template_params is structured-only (no free-form prose strings); (c) hard-fail (uncited/unresolvable) → entire narrative rejected, deterministic fallback renders; (d) the renderer is pure (same records → same prose); (e) `output-language-lint` zero hits on rendered narrative.

## Goal

AI authors the report narrative — but as structured claim records a deterministic renderer turns into prose using checked-in templates, with a claim-linter that makes every material sentence cite a resolvable fact/finding/predicate-output. AI cannot emit free-form prose; it cannot hallucinate an uncited claim. This is the PLAN-v1 §D.A mechanism, which never depended on the topo-sort and carries intact.

## What lands

- `narrative-author` agent (a tool the loop may call, or a post-floor composer — emits `ClaimRecord[]`).
- `claim-linter.ts` (deterministic, zero AI calls).
- `narrative-renderer.ts` (pure function over records + templates).
- Templates per `(claim_type, predicate_kind)`.
- Phase 2 `ai-explainer` marked DEPRECATED with the 3-trigger removal contract (PLAN-v1 §D.D); removal is a future-phase step.
- Tests per Verification.

## Done when

All Verification assertions pass. The fixture scan renders an authored narrative whose every material sentence cites real evidence; an uncited claim fails closed to the deterministic fallback.

## Guardrails

- Per CLAUDE.md §Output language: templates + rendered narrative through `output-language-lint`; never secure/safe/compliant.
- AI authors `ClaimRecord[]`, never prose; the renderer is the only prose source.
- Claim-linter is deterministic (no recursive AI dependency).

## References

- `PLAN.md §G`; PLAN-v1 §D.A (claim-record mechanism) + §D.D (ai-explainer deprecation triggers)
