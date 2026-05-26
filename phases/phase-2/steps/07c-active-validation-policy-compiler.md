# Step 07c — `ActiveValidationPolicyCompiler` (Phase 2)

**Status:** done (2026-05-26)
**Maps to:** `REVISION_AI_SHAPE.md §6.2, §7.4`; `PHASE_2_PLAN §4 AI-first revision additions`
**Amends Phase 2 step:** none — new step file (lands after Phase 2 step 07 catalog ships)
**Produces:** infra at `src/core/policy/active-validation-policy-compiler.ts`
**Depends on:** Phase 2 step 02 (shared plan types in `src/types/scan-plan.ts`), Phase 2 step 07 (catalog manifest), Phase 1 step 02b (`AllowedAction`, `ValidationPolicy`, `ControlId`)
**Executed by:** plain coding pass
**Verification:** compile-rejects-out-of-allowed-actions test; compile-injects-missing-baseline test; compile-rejects-unknown-target test; per-scan budget-cap test; shared-zero-code-with-ContextPolicyEvaluator audit; plan-source-agnostic test (deterministic-fallback plan compiles identically)

## Goal

Deterministic gate for any **`ProposedScanPlan`** — regardless of producer. The compiler validates plans typed against the shared `ProposedScanPlan` schema (from Phase 2 step 02), drawn from the closed catalog (Phase 2 step 07), against the active `ValidationPolicy`. **It is plan-source-agnostic by design:** the AI Security Planner (step 07b) is one producer, but a deterministic-fallback generator (used in `--no-ai` runs) is another, and a human-authored plan is a third. The compiler's safety guarantees do not depend on the producer being trustworthy.

**Distinct from `ContextPolicyEvaluator`** (Phase 1 step 08c) — they share zero code beyond the registry, `Result<T, E>`, and the `AllowedAction` type. Compiler is the bridge between "something proposed X" and "we execute X."

## What lands

- `src/core/policy/active-validation-policy-compiler.ts`:
  - `compile(proposed: ProposedScanPlan, policy: ValidationPolicy): Result<CompiledScanPlan, ActiveValidationCompilationError>`
  - Checks (in order):
    1. Every entry's action is in `policy.allowed_actions` (Mode B `sandbox_active_validation` allowed_actions set).
    2. Every entry's target exists in the project's known surface — route exists in `inventory-bootstrap.json`, table exists in `scan-facts.json`, bucket exists in MCP-derived storage metadata. Unknown target → reject with structured error.
    3. Every mandatory-baseline control has an entry. If AI omitted one, **inject the default entry** from the deterministic plan (`phases/phase-2/steps/10a-10d` outputs). Compiler does not reject the whole plan over omissions.
    4. No entry exceeds per-scan budget caps from `SyntheticDataPolicy` (max identities, tenants, records).
  - Returns `CompiledScanPlan` ready for sandbox-runner execution OR `ActiveValidationCompilationError` listing rejected entries.

## Done when

- Compile-rejects-out-of-allowed-actions test: entry with `create_synthetic_user` under a `read_only_evidence` policy → rejected with explicit reason.
- Compile-injects-missing-baseline test: AI omits cc-11-5; compiler injects from the deterministic plan; final compiled plan has cc-11-5.
- Compile-rejects-unknown-target test: AI proposes `cc-11-3` against a route that doesn't exist in inventory → rejected.
- Per-scan budget-cap test: AI proposes 10000 synthetic identities when `SyntheticDataPolicy.max_identities = 100` → rejected.
- Import-graph audit: compiler shares zero code with `ContextPolicyEvaluator` beyond the registry + `Result`. Verified by an explicit test.

## Guardrails

- **Constraint 6 enforced:** compiler injects missing baseline entries. AI cannot silently delete from the floor.
- Per `REVISION_AI_SHAPE §6.2`: distinct file, distinct types, distinct tests from `ContextPolicyEvaluator`.
- Per `PHASE_2_PLAN §1.1`: compiler also validates that `read_only=true` and `project_ref` are correctly set on any Supabase MCP entries the plan still includes.
- Per `FPP §2A`: compiler iterates `policy.allowed_actions` as a `Set<AllowedAction>`, never switches on action-name strings.
- Compiler is the safety net — even if AI Security Planner regresses, compiler keeps the floor intact.

## References

- `REVISION_AI_SHAPE.md` §6.2, §7.4
- `PHASE_2_PLAN.md` §4 (Compiler addition), §11.1 (approval policy interacts here)
- `phases/phase-2/steps/02-land-deferred-types-and-action-executor.md` (shared plan types `ProposedScanPlan` / `CompiledScanPlan` — the contract this compiler operates over)
- `phases/phase-2/steps/07-negative-test-catalog.md` (catalog manifest — the closed set of `test_id`s a plan may reference)
- 07b is **one** producer of `ProposedScanPlan` that this compiler accepts. It is not a runtime dependency of the compiler; the compiler validates any well-typed plan regardless of source.
- `phases/phase-1/steps/08c-context-policy-evaluator.md` (the OTHER policy — sibling but separate)
