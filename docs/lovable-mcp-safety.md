# Lovable MCP connector — how Veyra uses it

Derived from `phases/phase-1/PHASE_1_PLAN.md §3 Step 1` (Lovable
allowlist) and `CLAUDE.md §MCP discipline`.

The Lovable connector is a **collector only**. It does not contain
security reasoning, does not classify findings, and does not change
the project. Its job is to fetch declared intent and file inventory.

> **Phase 1 implementation state.** The connector's allowlist policy
> and `send_message` template-only enforcement are shipped and tested.
> The production OAuth-backed MCP transport itself is Phase 2 work;
> Phase 1 ships the contained transport boundary
> (`src/connectors/lovable/client.ts` accepts an injectable
> `LovableTransport`) per the CLAUDE.md §Resolved engineering
> decisions fallback path.

## The six-tool allowlist

Veyra calls only these tools:

- `get_project`
- `list_files`
- `read_file`
- `list_edits`
- `get_diff`
- `send_message` — only with `plan_mode: true` and only via a fixed
  prompt-template id (see below)

Any other Lovable MCP tool — including newer ones such as `get_me`,
`list_workspaces`, `list_projects`, `get_project_knowledge`,
`list_mcp_servers`, `get_project_analytics`, `deploy_edge_function` —
is auto-denied because it is not on the allowlist. Adding a new tool
requires a code change and a Phase-N planning decision; the connector
will not invoke an unrecognized tool just because the Lovable server
exposes it.

## The four fixed prompt templates

`send_message` does not accept free-form text. The connector accepts a
template id only:

- `templates.project_overview` — "What does this project do at a high
  level?"
- `templates.user_flows` — "What are the primary user-facing flows in
  this project?"
- `templates.data_handling` — "What kinds of data does this project
  store or process?"
- `templates.auth_model` — "What authentication and authorization model
  does this project use?"

The exact text is checked in at
`src/connectors/lovable/prompt-templates.ts`. Adding a template is a
code change subject to review.

## How responses are treated

Lovable answers are **declared intent**, not proof. The
product-understanding agent stores Lovable responses in
`declared_intent` only — never in `observed_evidence`. The composer at
`src/core/declared-context/builder.ts` enforces this field-by-owner
boundary at write time; an artifact that tries to set the wrong field
is rejected.

The report frames declared intent as "the project says it does X," not
"the project does X."

## Auth

Phase 1 supports the Lovable MCP OAuth flow. Personal-access tokens
are not supported.

## Opt-in

The connector does not run unless you pass `--lovable-mcp
--lovable-project <id>`. Without those flags the deterministic
baseline (local file walk + package.json read) runs alone.

## What this enforcement protects against

- A newly added Lovable tool that does something destructive does not
  reach the wire because allowlists default-deny.
- A compromised or hallucinated prompt-template id is rejected at the
  policy layer.
- A free-form `send_message` text body is rejected at the policy layer
  — there is no path from caller input to an arbitrary message body.
