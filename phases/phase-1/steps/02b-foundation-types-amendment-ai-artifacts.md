# Step 02b — Foundation types amendment (AI artifacts)

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §3, §5, §6 (interface stubs), §7.4`; `PHASE_1_PLAN §5 alignment note`; `FPP §10 alignment note`
**Amends Phase 1 step:** 02
**Produces:** new types in `src/types/`
**Depends on:** none
**Executed by:** plain coding pass
**Verification:** `pnpm typecheck`; exhaustiveness tests on each new discriminated union; brand-type unit tests; no-import-from-agents guardrail

## Goal

Add the four new artifact types from the AI-first revision (`ScanFact`, `Hypothesis`, `AIConcern`, `ContextRequest`) plus the `AssertionPredicate` shape plus interface stubs for the new policy modules. Pure types — no behaviour, no SDK imports.

## What lands

- `src/types/scan-fact.ts` — `ScanFact` discriminated union with generic `kind`s (`scanner_match`, `schema_element`, `mcp_response`, `local_file`) and opaque `ScannerId`/`ParserId`/`ConnectorId` fields. Plus `ScanFactPayload` for sanitized excerpts. Shape per revision §3.1.
- `src/types/hypothesis.ts` — `Hypothesis` shape per revision §3.2. `proposed_finding_type` closed to `'likely_issue' | 'informational'`.
- `src/types/ai-concern.ts` — `AIConcern` shape per revision §3.4. `category` enum: `'no_predicate_fired' | 'insufficient_facts'` (no `predicate_contradicted`).
- `src/types/context-request.ts` — `ContextRequest` with discriminated `args` (per revision §5).
- `src/types/assertion-predicate.ts` — `AssertionPredicate` signature `(ScanFact[], DeclaredContext) → Finding | null`. Pure function shape.
- `src/types/finding.ts` — extend with optional `supporting_hypothesis_refs?: HypothesisRef[]`. `evidence_refs` stays fact-only.
- `src/core/policy/context-policy-evaluator.ts` — interface stub only. `evaluate(request, policy) → Promise<Result<ScanFact[], ContextPolicyError>>`.
- `src/core/policy/active-validation-policy-compiler.ts` — interface stub only. Distinct file from `ContextPolicyEvaluator` per revision §6.
- `src/types/sanitized-message.ts` — `SanitizedMessage` branded string type.
- `src/types/prompt-template.ts` — `PromptTemplateId` branded string type.

## Done when

- Every new type compiles under strict mode.
- Exhaustiveness check tests fail the build if a discriminator is added without a handler.
- `SanitizedMessage` and `PromptTemplateId` are usable as brands; cannot be assigned from raw `string`.
- `AssertionPredicate` signature exactly matches revision §4.1: `(ScanFact[], DeclaredContext) → Finding | null`. The predicate signature does NOT accept `Hypothesis[]` — predicates are fact-only by type.
- No file in `src/types/` or `src/core/` imports from `src/agents/`, `src/connectors/`, `src/scanners/`, or any AI provider SDK.
- `pnpm typecheck` is green.

## Guardrails

- No SDK imports. The Anthropic SDK lives in 02d, not here.
- No provider-name string unions in shared types (`'lovable' | 'supabase'`, `'gitleaks' | 'osv' | 'semgrep'` — forbidden per `FPP §2A`). Use opaque IDs.
- `Hypothesis.proposed_finding_type` is a closed enum that excludes `confirmed_issue`, `missing_evidence`, `coverage_gap`. Only the assertion layer can produce those.
- `Finding.evidence_refs` is `ScanFactRef[]` only. Hypotheses attach via the separate `supporting_hypothesis_refs` field.
- `AIConcern.category` excludes `predicate_contradicted` — contradicted hypotheses go to `assertions.json` only (revision §4.2 rule 2).

## References

- `REVISION_AI_SHAPE.md` §3 (four artifact types), §4 (two-pass model), §5 (ContextRequest), §6 (policy split), §8 (ten trust-model constraints)
- `phase-1/steps/02-foundation-types-artifact-store-policy.md` (the original step this amends)
- `CLAUDE.md` §Extensibility-first architecture
