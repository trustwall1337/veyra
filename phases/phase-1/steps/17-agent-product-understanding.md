# Step 17 — Product-understanding agent

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 5`, §4.1, §3 Step 1
**Produces:** `src/agents/product-understanding/`
**Depends on:** 02, 15
**Executed by:** `/new-agent` skill
**Verification:** integration test against fixture (no-MCP path) + mock-MCP test (connected path); assert declared intent and observed evidence are stored separately

## Goal

Build a functional and technical map of the app. Has two modes:
- **Local-first (default):** read the project structure, package.json, route files, env declarations.
- **MCP-enabled (`--lovable-mcp`):** also call the Lovable connector for declared intent (project description, file listings, edits history).

Outputs `declared-context.json` with declared intent and observed evidence stored in SEPARATE fields.

## What lands

- `src/agents/product-understanding/agent.ts` — implements `VeyraAgent`. Branches on `context.flags.lovableMcp`.
- `src/agents/product-understanding/local-pass.ts` — local filesystem scan: route file inventory, package.json analysis, env declarations, framework detection (Vite, Next, etc.).
- `src/agents/product-understanding/mcp-pass.ts` — wraps `src/connectors/lovable/` calls (`get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` with `plan_mode`).
- Output artifact: `declared-context.json` with shape `{ declared_intent: {...}, observed_evidence: {...}, sources: [...] }`.
- Tests: integration against fixture (no-MCP path) + mock-MCP test (connected path).

## Done when

- `/new-agent` skill checklist all green.
- `declared-context.json` is well-formed under both paths.
- Declared intent (MCP `get_project` / `send_message` answers) is in `declared_intent`, never mixed into `observed_evidence`. Connected-mode outputs carry `reproducibility: mcp_context`.
- Local-only mode produces a useful (if smaller) context. Veyra must work without MCP per §1 verified capabilities.
- `output-language-lint` clean.

## Guardrails

- Per §4.1: "Treat Lovable answers as declared intent, not proof. Do not use mutation tools. Do not use deployment or database mutation tools."
- Agent must NOT call any Lovable tool outside the six-tool allowlist (enforced by the connector's policy guard).
- `send_message` calls always set `plan_mode: true` and ask read-only questions only.
- Declared intent and observed evidence are stored separately so the report agent can frame intent as "the project says" not "the project does".

## References

- `PHASE_1_PLAN.md` §4.1 (Product-understanding controls), §7 Task 5, §3 Step 1
- `.claude/skills/new-agent/SKILL.md`
- Step 15 Lovable connector
