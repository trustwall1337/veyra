# Step 08c — `ContextPolicyEvaluator` standalone module (Phase 1 policy half)

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §5 deny rules, §5.2 sanitization order, §5.3 prompt-injection guard, §6.1 interface`
**Amends Phase 1 step:** none — new step file
**Produces:** `src/core/policy/context-policy-evaluator.ts` + tests
**Depends on:** 02b, 02c
**Executed by:** plain coding pass
**Verification:** deny-rule unit tests; sanitization-twice round-trip; prompt-injection heuristic test; retry-cap counter test; `Result<ScanFact[], ContextPolicyError>` shape verified

## Goal

Deterministic gate for AI's `ContextRequest`s. AI never holds credentials; this module is the only thing that fetches context on AI's behalf. Distinct file, distinct types, distinct tests from `ActiveValidationPolicyCompiler` (Phase 2 step 07c) per revision §6 — they share zero code beyond the registry and `Result<T, E>`.

## What lands

- `src/core/policy/context-policy-evaluator.ts`:
  - `evaluate(request: ContextRequest, policy: ValidationPolicy): Promise<Result<ScanFact[], ContextPolicyError>>`
  - For each `request.kind`, applies the deny rules from revision §5.1:
    - `read_file`: deny `.env*`, `**/credentials*`, `**/secrets*`, `**/*.pem`, `**/*.key`, `**/id_rsa*`, `**/*.p12`, `**/*.pfx`, `**/.aws/`, `**/.ssh/`; deny binary extensions; deny generated bundles (`dist/`, `build/`, `node_modules/`, `.next/`, `coverage/`, `out/`); cap at 200KB; deny path traversal (`..`, absolute paths, outside project root).
    - `list_files`: only the configured Lovable `project_id`. No traversal.
    - `get_supabase_table_meta` / `get_supabase_advisors`: only the configured `project_ref`. `read_only=true` enforced. No row-level filters.
    - `send_message_template`: only the four fixed `PromptTemplateId`s. No free-form text. `plan_mode: true` always.
  - On grant: runs sanitization (revision §5.2): redact-before-store on the fetched content, then again before AI input via the `wrapAsObservedContent` helper from 02c. Returns `ScanFact[]` with `source.payload.sanitized_excerpt` populated.
  - On deny: returns `Result.err(ContextPolicyError)` with the rejection reason. Logs request_id + category to `scan-actions.log` — never logs the args.
  - Retry-counting: per-scan counter (default hard cap 2 per §14 Q3). Rejects after the cap with `ContextPolicyError.kind = 'retry_cap_exhausted'`.

## Done when

- Every §5.1 deny rule has a unit test for both grant and deny cases.
- Sanitization-twice test: fetched content with secret-like patterns shows zero raw matches in the returned `ScanFact.source.payload.sanitized_excerpt`.
- Prompt-injection guard: a fetched file containing `<observed_content>...</observed_content>` self-references or known-injection patterns is wrapped + flagged in `scan-actions.log` but not blocked at fetch time (the inference agent decides whether to discard).
- Retry-cap test: 3rd retry within one scan returns `Result.err(ContextPolicyError.kind = 'retry_cap_exhausted')`.
- Shared zero code with `ActiveValidationPolicyCompiler`: import-graph test confirms.

## Guardrails

- **Constraint 5 enforced:** AI never holds credentials or calls connectors. This module is the only path.
- Per `REVISION_AI_SHAPE §6`: split from `ActiveValidationPolicyCompiler`. Distinct file, distinct interface, distinct tests. They share the registry and the `Result` type — nothing else.
- Per `FPP §2A`: deny-rule lists live in this file as checked-in code. Adding a new deny pattern is a code change with a test; never a runtime AI decision.
- Path-traversal denial uses normalized path checks against the configured project root. No regex-only matching that can be bypassed by Unicode tricks.

## References

- `REVISION_AI_SHAPE.md` §5, §6.1
- 02b (`ContextRequest` type, `ContextPolicyError` type)
- 02c (sanitization helpers)
