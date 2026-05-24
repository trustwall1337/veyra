# Step 02 — Phase 2 deferred types + `ActionExecutor` interface

**Status:** not started
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

### `src/core/policy/executors/types.ts` (new)

- `ActionExecutor` interface:
  - `id: ConnectorId` — registry key
  - `supportsMode(mode: ValidationMode): boolean`
  - `execute<A extends AllowedAction>(action, args, context): Promise<Result<ExecutionReceipt, ExecutorError>>`
- `ExecutionReceipt = { action, started_at, completed_at, args_fingerprint_sha256, outcome: 'ok' | 'denied' | 'failed', details? }`
- `ExecutorError` subclass of `Error`

If decision 2 in step 01 chose "Phase 1 step 02 stub," update Phase 1 step 02 to add the interface type definition (no implementation) and have Phase 2 step 02 import from it. Otherwise the interface lives in Phase 2 step 02.

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
