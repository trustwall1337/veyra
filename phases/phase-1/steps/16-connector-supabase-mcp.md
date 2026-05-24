# Step 16 — Supabase MCP read-only connector

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 8`, §4.4, `CLAUDE.md §MCP discipline`
**Produces:** `src/connectors/supabase/`
**Depends on:** 02
**Executed by:** `/new-connector` skill (+ `mcp-policy-check` subagent for review)
**Verification:** mock-MCP-client tests for per-call guard + `mcp-policy-check` clean

## Goal

Supabase MCP client. Every tool call goes through the policy guard in `src/core/policy/` — the connector does NOT hardcode `read_only=true`. Under the Phase 1 `read_only_evidence` policy the guard emits `read_only=true` automatically; future modes may relax this with explicit approval.

Mutating tools and user-row queries are denied regardless of policy. The `project_ref` constraint is independent of the policy and always required.

## What lands

- `src/connectors/supabase/client.ts` — wraps `@modelcontextprotocol/sdk` client. Requires `project_ref` at construction. For each tool invocation, derives the `read_only` flag and per-call permissions from `ValidationPolicy.allowed_actions` — the connector does not own the decision.
- `src/connectors/supabase/policy.ts` — connector-side allowlist; defers per-call decisions to `src/core/policy/tool-policy.ts`. Translates `AllowedAction` → MCP tool parameters.
- `src/connectors/supabase/types.ts` — typed wrappers for allowed tools.
- `src/connectors/supabase/storage-buckets.ts` — small module that, when `list_storage_buckets` is enabled, fetches and writes `storage-buckets.json` artifact for step 09's bucket-detection path.
- Mock client + fixture tests.

## Allowlist (Phase 1, under `read_only_evidence` policy)

- `list_tables`
- `list_extensions`
- `list_migrations`
- `get_advisors`
- `get_logs` — only when `policy.allowed_actions.has('read_application_logs')`, which is FALSE in the default `read_only_evidence` policy. **Effectively disabled in Phase 1** — production logs may contain PII / secrets / session tokens and require explicit policy upgrade.
- `list_edge_functions`
- `get_edge_function`
- `list_storage_buckets`
- `get_storage_config`

## Denied (regardless of policy in Phase 1)

- `execute_sql` — denied even with `read_only=true`. Per §4.4: "Do not query user data." Schema-shape data comes from `list_tables` + `get_advisors`. Decision ratified in step 01.
- `apply_migration` — mutating
- `deploy_edge_function` — mutating
- Branch tools — mutating
- `update_storage_config` — mutating
- Anything not on the allowlist

## Done when

- `/new-connector` skill checklist all green.
- Per-call policy guard verified by test:
  - Call without `read_only=true` (impossible under `read_only_evidence` policy) → `PolicyViolationError` before transport
  - Call without `project_ref` → `PolicyViolationError`
  - `execute_sql` with `read_only=true` → still denied
  - `get_logs` under default `read_only_evidence` policy → denied (`read_application_logs` not in allowed_actions)
  - Allowed tool with both flags → succeeds
  - Missing storage permission server-side → connector returns `coverage_gap`-shaped result, doesn't crash
  - `list_storage_buckets` success → writes `storage-buckets.json` artifact for step 09
- `mcp-policy-check` subagent on the diff returns zero violations.
- Per-call guard lives in `src/core/policy/tool-policy.ts`, parameterized by service ID — not duplicated inside the connector.

## Guardrails

- Per §4.4 (verbatim): "Do not query user data. Do not apply migrations. Do not change policies."
- Per §7 Task 8: "The connector must enforce read-only policy before every tool call." Startup-only enforcement is a launch-blocker for Veyra itself.
- Storage tools are "disabled by default" server-side. Connector accepts that as `coverage_gap`, not as an error.
- Connector contains no security reasoning. The supabase-rls agent (step 09) and authz-tenant agent (step 11) own classification.
- **`read_only` is computed from policy. Do NOT hardcode it as a constant in the connector** — that's the bug the validation-policy seam exists to prevent.

## References

- `PHASE_1_PLAN.md` §1 (Supabase MCP verified), §4.4 (controls), §7 Task 8
- `CLAUDE.md` §MCP discipline
- `.claude/skills/new-connector/SKILL.md`, `.claude/agents/mcp-policy-check.md`
- Step 02 `ValidationPolicy`
- Step 09 supabase-rls agent (consumer of `storage-buckets.json`)
