# Step 03 — `SandboxExecutor` + policy wiring for Mode B

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 2`, §1.1, §11.2
**Produces:** infra (`src/core/policy/executors/sandbox/`)
**Depends on:** 02
**Executed by:** plain coding pass (+ `mcp-policy-check` subagent on the diff)
**Verification:** Vitest unit tests for executor allow/deny per `AllowedAction`; `mcp-policy-check` returns zero hits; registry collision test stays green

## Goal

Implement the first `ActionExecutor` — `SandboxExecutor`. Wire `tool-policy.ts` so that `sandbox_active_validation` mode populates the right `allowed_actions` set. Mode B becomes structurally enabled at the policy layer (the CLI flip in step 11 just removes the parse-time rejection).

## What lands

- `src/core/policy/executors/sandbox/executor.ts` — implements `ActionExecutor`. Each action (`create_synthetic_user`, `create_synthetic_tenant`, `create_synthetic_record`, `call_api_with_test_identity`, `verify_denial`, `cleanup_veyra_created_data`) routes to a registered handler. Phase 2 ships Supabase handlers only — registered by `ConnectorId`.
- `src/core/policy/executors/sandbox/handlers/supabase.ts` — handler stubs that the `synthetic-data-manager` agent (step 06) will call into via the Admin SDK wrapper. Stubs return `Result.err(NotImplementedError)` until step 06 lands them.
- `src/core/policy/executors/sandbox/index.ts` — registers the executor with `src/core/registry/service-registry.ts` using its `ConnectorId`.
- Update `src/core/policy/tool-policy.ts` to populate `allowed_actions` based on `policy.mode`:
  - `read_only_evidence`: read actions only (Phase 1 set, unchanged)
  - `sandbox_active_validation`: read actions + the six synthetic-data actions above
  - `approved_production_safe`: still rejected; later phase (product-rollout placement `FPP §17 Phase 5`)
- `src/core/policy/executors/sandbox/__fixtures__/` + tests.

## Done when

- Executor registered by `ConnectorId` (no `if (mode === 'sandbox')` in shared code).
- Unit tests cover: allowed action under Mode B succeeds; same action under Mode A returns `PolicyViolationError`; unknown action returns `PolicyViolationError`; Mode C action returns `PolicyViolationError` with explicit "not yet implemented (later phase; see `FPP §17 Phase 5`)" reason.
- `mcp-policy-check` on the diff returns zero hits (this step does not touch MCP — but a guard run is cheap and catches accidental drift).
- Registry collision test from step 02 still passes.
- The Supabase MCP connector (Phase 1 step 16) is NOT widened — Admin API path is structurally separate.

## Guardrails

- Per `FINAL_PRODUCT_PLAN §2A` rule 3: `tool-policy.ts` reads per-service allowlists from a registry. No `if (service === 'supabase')` in shared code.
- Per `PHASE_2_PLAN §1.1`: Supabase Admin API is a separate path from Supabase MCP. Do NOT add `execute_sql`/`apply_migration`/branch tools to the MCP allowlist.
- Per `FPP §2A` rule 1: `SandboxExecutor` is keyed by `ConnectorId`, not a `ModeId`. Future Firebase / Clerk synthetic-data executor registers the same way.
- Stubs return `NotImplementedError` cleanly; no silent no-op handlers.

## References

- `PHASE_2_PLAN.md` §1.1 (Supabase Admin API permitted/forbidden), §3 (active validation flow), §11.2 (synthetic-data namespace)
- `FINAL_PRODUCT_PLAN.md` §2A (extensibility rules)
- Step 02 `ActionExecutor` interface
- Phase 1 step 16 (Supabase MCP connector — must not widen)
