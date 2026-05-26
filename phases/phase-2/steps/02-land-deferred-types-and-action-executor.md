# Step 02 — Phase 2 deferred types + `ActionExecutor` interface

**Status:** done (2026-05-26)
**Maps to:** `PHASE_2_PLAN §7 Task 1`, §5.1, §6.1
**Produces:** types in `src/types/active-validation.ts` (was placeholder) + `src/core/policy/executors/types.ts`
**Depends on:** 01
**Executed by:** plain coding pass
**Verification:** Vitest exhaustiveness check on `EvidenceKind` discriminator; `pnpm typecheck` green; no import from `src/types/` to `src/agents | connectors | scanners`

## Goal

Fill the Phase 1 placeholder file `src/types/active-validation.ts` with the five deferred Phase 2 types plus `TestPlanEntry`, and introduce the `ActionExecutor` interface that the sandbox executor (step 03) implements. Foundation — every later Phase 2 step imports from here.

## What lands

### `src/types/active-validation.ts` (replaces placeholder)

- `TestIdentity = { id, scan_id, supabase_user_id, role, tenant_id?, created_at }`
- `TestTenant = { id, scan_id, name, owner_test_identity_id, created_at }`
- `TestRecord = { id, scan_id, table, row_data_fingerprint, created_at }`
- `SyntheticDataPolicy = { namespace_prefix, max_identities, max_tenants, max_records, max_lifetime_seconds }`
- `CleanupPolicy = { strategy: 'hard_delete' | 'soft_with_purge', verify_residual_count: true, on_cleanup_failure: 'fail_scan' }`
- `ActiveValidationResult = { test_id, control_id, outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive', evidence_refs[], duration_ms, synthetic_data_refs[], assertion_details }`
- `TestPlanEntry = { test_id, control_id, owning_agent_id, required_synthetic_resources, expected_outcome_hint, max_duration_ms }`

### `src/types/scan-plan.ts` (NEW — shared plan types)

Plan types live in their own file because they have **two distinct producers** (the AI Security Planner from step 07b and any deterministic-fallback plan generator) and **one consumer** (the `ActiveValidationPolicyCompiler` from step 07c). The compiler is plan-source-agnostic: it must work on any well-typed plan, not just AI-produced ones.

- `ProposedScanPlan = { scan_id, generated_by: 'ai_security_planner' | 'deterministic_fallback', entries: ProposedScanPlanEntry[], generated_at }`
- `ProposedScanPlanEntry = { test_id, control_id, priority: 'low'|'medium'|'high', parameters: Record<string, unknown>, justification: string }`
- `CompiledScanPlan = { scan_id, source: ProposedScanPlan['generated_by'], entries: CompiledScanPlanEntry[], compiled_at, baseline_injections: string[] }`
- `CompiledScanPlanEntry = ProposedScanPlanEntry + { validated_target_ref: TargetRef, allowed_actions_satisfied: AllowedAction[] }`
- `ActiveValidationCompilationError = { rejected_entries: Array<{ entry, reason }>, missing_baseline_controls: ControlId[] }` — note that missing-baseline is recorded for audit but doesn't cause rejection; the compiler injects from the deterministic fallback.

### `ActionExecutor` interface

**Birthplace resolved: Phase 1 step 02** (typed stub only; no implementation in Phase 1). Phase 2 step 02 imports the interface from `src/core/policy/executors/types.ts` and adds nothing to it — the type shape is locked when Phase 1 step 02 lands. Step 01 decision 2 ratifies this.

Interface shape (already in Phase 1 step 02):
- `id: ConnectorId` — registry key
- `supportsMode(mode: ValidationMode): boolean`
- `execute<A extends AllowedAction>(action, args, context): Promise<Result<ExecutionReceipt, ExecutorError>>`
- `ExecutionReceipt = { action, started_at, completed_at, args_fingerprint_sha256, outcome: 'ok' | 'denied' | 'failed', details? }`
- `ExecutorError` subclass of `Error`

Phase 2 step 02 imports these without modification. The implementation (`SandboxExecutor`) lands in step 03.

## Done when

- Every type compiles under strict mode.
- `pnpm typecheck` is green.
- Vitest exhaustiveness check fails the build if a new `EvidenceKind` is added without a handler.
- `src/types/active-validation.ts` no longer carries the "intentionally empty" TSDoc note from Phase 1 step 02.
- No `import` from `src/types/` or `src/core/` points at `src/agents/`, `src/connectors/`, or `src/scanners/`.

## Guardrails

- Per `FINAL_PRODUCT_PLAN §2A`: no hardcoded provider names. `ActionExecutor.id` is `ConnectorId`, NOT `'supabase' | 'firebase'` union.
- `ActiveValidationResult.outcome` is a closed literal union (`'proven_denial' | 'proven_allowed' | 'inconclusive'`). New outcomes require a typed extension, not a string.
- Expected-failure paths return `Result<T, E>` from `src/types/result.ts`. Reserve `throw` for unexpected failures.
- No `any`. Use `unknown` and narrow with type guards.
- These types must not import from active-validation IMPLEMENTATION (which doesn't exist yet); types are pure shape.

## References

- `PHASE_2_PLAN.md` §5.1 (evidence kinds extended), §6.1 (Required)
- Phase 1 step 02 (`src/types/active-validation.ts` placeholder)
- `CLAUDE.md` §TypeScript conventions, §Extensibility-first architecture
