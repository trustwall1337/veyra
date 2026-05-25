# Step 15 — Lovable MCP connector

**Status:** done (2026-05-25)
**Maps to:** `PHASE_1_PLAN §7 Task 7`, §3 Step 1 (Lovable allowlist), `CLAUDE.md §MCP discipline`
**Produces:** `src/connectors/lovable/`
**Depends on:** 02
**Executed by:** `/new-connector` skill (+ `mcp-policy-check` subagent for review)
**Verification:** mock-MCP-client tests for allowlist + fixed-template enforcement + `mcp-policy-check` returns zero violations

## Goal

Strict-allowlist MCP client for Lovable. The connector is a collector only — no security reasoning. New Lovable tools released after the plan was written stay forbidden by default (allowlist-only design).

`send_message` is restricted to a **fixed allowlist of prompt templates** — not free-form text classification. Classifying arbitrary natural-language intent ("is this read-only?") isn't deterministic; template IDs are.

## What lands

- `src/connectors/lovable/client.ts` — wraps `@modelcontextprotocol/sdk` client, OAuth-only auth (no PAT — per §1 not yet supported). Takes `project_id` passed in from CLI `--lovable-project` flag.
- `src/connectors/lovable/policy.ts` — declares the connector's allowlist; calls `src/core/policy/tool-policy.ts` before every tool invocation.
- `src/connectors/lovable/types.ts` — typed wrappers for the six allowed tools.
- `src/connectors/lovable/prompt-templates.ts` — the four allowed `send_message` templates (see below). Adding a template requires a code change.
- Mock MCP client + fixture tests under `src/connectors/lovable/__fixtures__/`.

## Allowlist (exact, verbatim from §3 Step 1)

- `get_project`
- `list_files`
- `read_file`
- `list_edits`
- `get_diff`
- `send_message` — only with `plan_mode: true`, only via fixed template IDs (see below)

## Allowed `send_message` templates

The connector API does not accept free-form text. It accepts a template ID:

- `templates.project_overview` — "What does this project do at a high level?"
- `templates.user_flows` — "What are the primary user-facing flows in this project?"
- `templates.data_handling` — "What kinds of data does this project store or process?"
- `templates.auth_model` — "What authentication and authorization model does this project use?"

The exact prompt text is checked into `prompt-templates.ts`. Adding a new template requires a code change and a `mcp-policy-check` review. Connector callers (the product-understanding agent) cannot inject text — they pass a template ID and optional structured slots.

## Done when

- `/new-connector` skill checklist all green.
- Mock-client tests cover:
  - Each allowed tool succeeds and returns typed output
  - Any non-allowlisted tool returns `PolicyViolationError` BEFORE reaching the MCP transport
  - `send_message` with `plan_mode: false` (or missing) is denied
  - `send_message` with any unknown template ID is denied
  - `send_message` with free-form text (no template ID) is denied
  - Each fixed template ID is accepted and sends the canonical text with `plan_mode: true`
- `mcp-policy-check` subagent run on the diff returns zero violations.
- Connector contains NO classification or finding logic. Output is raw MCP responses (sanitized of secrets if any appear).

## Guardrails

- The denylist in §3 Step 1 is binding: `create_project`, `deploy_project`, `remix_project`, `set_project_visibility`, `enable_database`, `query_database`, `get_database_connection_info`, `set_workspace_knowledge`, `set_project_knowledge`, `add_mcp_server`, `remove_mcp_server`. Newly available tools (`get_me`, `list_workspaces`, `list_projects`, `get_project_knowledge`, `list_mcp_servers`, `get_project_analytics`, `deploy_edge_function`, etc.) are auto-denied because they are not on the allowlist.
- Connector reasoning is forbidden: per §7 Task 7 "The connector must not contain security reasoning." If you find yourself adding `if (response.indicates_X) { ... }`, that logic belongs in the product-understanding agent (step 17), not here.
- Lovable answers are declared intent, not proof. Mark all connector outputs with `reproducibility: mcp_context` when consumed downstream.
- Free-form `send_message` text from callers is rejected. Only template IDs from `prompt-templates.ts`.

## References

- `PHASE_1_PLAN.md` §1 (Lovable MCP verified), §3 Step 1 (allowlist + denylist), §7 Task 7
- `CLAUDE.md` §MCP discipline
- `.claude/skills/new-connector/SKILL.md`, `.claude/agents/mcp-policy-check.md`
- Step 03 `--lovable-project` flag (which feeds the connector its `project_id`)
