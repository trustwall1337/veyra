---
name: new-connector
description: Use when scaffolding a new MCP connector under `src/connectors/` (Lovable or Supabase). Enforces the Lovable Phase 1 tool allowlist and the Supabase read_only=true + project_ref per-call rule. Provides connector + test templates and the policy-guard pattern. Do NOT use for editing existing connectors or for non-MCP integrations.
---

# Skill: new-connector

Scaffold a new MCP connector following CLAUDE.md §MCP discipline and PHASE_1_PLAN §3 Step 1 + §7 Tasks 7-8.

This skill assumes PHASE_1_PLAN §7 Task 2 (which creates `src/core/policy/tool-policy.ts`) is complete. The templates import the policy guard from there.

## When to use

User asks to:

- "create / scaffold / build the Lovable MCP connector"
- "create / scaffold / build the Supabase MCP connector"
- "wire up an MCP client for [Lovable | Supabase]"
- "add a new MCP connector"

Do NOT use when:

- editing call sites inside an existing connector (just edit the file)
- adding a non-MCP integration (e.g. a REST client) — that's not a connector
- changing policy rules themselves (those live in `src/core/policy/`, not in connectors)

## The two Phase 1 connectors

Only these are valid in Phase 1:

1. **`lovable`** (PHASE_1_PLAN §3 Step 1, §7 Task 7) — Lovable MCP server at `https://mcp.lovable.dev`. OAuth.
2. **`supabase`** (PHASE_1_PLAN §7 Task 8) — Supabase MCP server at `https://mcp.supabase.com/mcp`. OAuth or PAT.

Read the relevant §1 "Verified Capabilities" section for that service **before** writing anything. Any other connector is out of scope for Phase 1 — stop and ask.

## Hard rules — non-negotiable

These come from CLAUDE.md §MCP discipline. Violating any is a launch-blocker for Veyra itself.

### Lovable allowlist (Phase 1)

Only these tools may be called:

- `get_project`
- `list_files`
- `read_file`
- `list_edits`
- `get_diff`
- `send_message` — **only with `plan_mode: true`**, only for read-only project-description questions

Every other Lovable MCP tool is forbidden in Phase 1, including (non-exhaustive):
`create_project`, `deploy_project`, `remix_project`, `set_project_visibility`, `enable_database`, `query_database`, `get_database_connection_info`, `set_workspace_knowledge`, `set_project_knowledge`, `add_mcp_server`, `remove_mcp_server`.

### Supabase rules

- Every call must pass `read_only=true` AND a `project_ref`.
- Enforcement happens in `src/core/policy/tool-policy.ts` **before every tool call** — not just at client construction.
- Never query user rows (no `execute_sql` against user tables in Phase 1).
- Never run migrations, never mutate data, never change policies.

### Architecture rules

- The connector is a **collector**, not an analyzer. It contains no security reasoning — that lives in agents.
- The connector exposes one typed method per allowlisted tool. Do **not** add a generic `call(tool, args)` method — that defeats the allowlist.
- The allowlist is a `const` array, so it is grep-able and the type system narrows correctly.
- The policy guard is invoked **per call**, not at construction. State changes; rules don't.
- The connector imports the policy guard. The policy guard never imports the connector.

## Files to create

- `src/connectors/<service>/<service>.ts` — connector implementation
- `src/connectors/<service>/<service>.test.ts` — Vitest tests using a mock MCP client (never hit the real network in tests)
- `src/connectors/<service>/types.ts` — service-specific input/output types
- Remove `src/connectors/<service>/.gitkeep` if present

## Templates

Start from:

- `templates/connector.template.ts`
- `templates/connector.test.template.ts`

Placeholder convention:

| Placeholder            | Replace with                                  | Example      |
| ---------------------- | --------------------------------------------- | ------------ |
| `PlaceholderService`   | PascalCase service class name                 | `Lovable`    |
| `'placeholder-service'`| kebab-case service id (string literal only)   | `'lovable'`  |

Fill the `ALLOWLIST` array with the actual allowed tool names for that service. Source of truth: CLAUDE.md §MCP discipline (re-quoted above).

## Before you finish — checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Every public method calls the policy guard **before** invoking the MCP client
- [ ] The `ALLOWLIST` is a `const` array literal — not a string built dynamically
- [ ] No `any`, no `!` non-null assertions
- [ ] No generic `call(tool, args)` method — only typed per-tool methods
- [ ] Tests cover:
  - [ ] (a) allowlisted tool succeeds
  - [ ] (b) attempting a forbidden tool returns `PolicyViolationError`
  - [ ] (c) for Supabase: calls missing `read_only=true` fail
  - [ ] (d) for Supabase: calls missing `project_ref` fail
- [ ] Tests use a mock MCP client — no real network calls
- [ ] Errors are typed: `PolicyViolationError`, `McpClientError`, `PlaceholderServiceAuthError`
- [ ] For Lovable: `send_message` always sets `plan_mode: true`, never accepts a flag to disable it
- [ ] For Supabase: `read_only: true` and `project_ref` are baked into the connector config, not optional method parameters
- [ ] Connector contains no analysis logic — grep your diff for `secret`, `vulnerable`, `blocker`, `policy`-related reasoning; none should be in the connector
