# Step 33 — Concrete read-only tool descriptors in leaf folders + non-core registration

**Status:** done (2026-05-28)
**Maps to:** `PLAN.md §C` (tool catalog + placement rule), `§D.5` (allowlist-derived MCP descriptors)
**Phase:** 3, Cut 1
**Produces:** concrete read-only `ToolDescriptor`s in leaf folders — `src/scanners/*/tool.ts` (gitleaks/osv/semgrep), `src/connectors/supabase/tools/*` + `src/connectors/lovable/tools/*` (per allowlisted MCP method), `src/agents/*/tools/*` (read-file, read-schema decomposed from agents); `src/cli/tool-registration.ts` (non-core wiring layer — successor to `agent-registration.ts`).
**Depends on:** 30
**Executed by:** plain coding pass + `mcp-policy-check` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) **no generic `call-mcp` descriptor exists**; (b) **no descriptor for `execute_sql`** (or any `DENIED_TOOLS` member) — descriptor universe is derived mechanically from `SUPABASE_ALLOWLIST` + the Lovable allowlist; (c) invoke-time denial in `checkInvocation`/`SupabaseClient.invoke` still fires (defense-in-depth); (d) gitleaks descriptor hard-binds `--redact` (not a schema field); (e) **`no-cross-layer-imports` stays green — no concrete tool imported into `src/core`**.

## Goal

Register the read-only tool catalog the agentic loop calls. Per the placement rule, concrete descriptors live in leaf service folders (not core); `src/cli/tool-registration.ts` imports the core contract + the leaf descriptors and wires them. MCP descriptors are generated mechanically from the allowlists so `execute_sql` literally has no descriptor — AI cannot name it.

## What lands

- Scanner tools: `run-gitleaks` (`--redact` hard-bound), `run-osv`, `run-semgrep` — wrap existing adapters, emit `ScanFact[]` as `ToolResult`.
- MCP-read tools: one per allowlisted method (`read-schema-meta`, `read-storage-meta`, `read-file`, `list-files`, `get-diff`, ...), generated from the allowlist; each `invoke` routes through existing `checkInvocation` (Supabase: `read_only=true`+`project_ref` injected).
- `read-file`/`read-schema` tools (path-traversal guarded; `read_code` capability).
- `src/cli/tool-registration.ts` registers them all.
- Tests per Verification.

## Done when

All Verification assertions pass. The loop (Step 31) / plan-walker (Step 32) can call every read-only tool; `src/core` stays import-clean.

## Guardrails

- Per CLAUDE.md §MCP discipline: allowlists are the single compile-time descriptor source; no new tool promoted without an explicit decision; Supabase calls carry `read_only=true`+`project_ref`; `execute_sql` denied (now also no descriptor).
- Per CLAUDE.md §Secrets: gitleaks `--redact` hard-bound.
- Per CLAUDE.md §Architecture: concrete tools in leaf folders; registration in `src/cli`; core stays clean.

## References

- `PLAN.md §C`, `§D.5`; `src/connectors/supabase/policy.ts:38/50/71`, `client.ts:97`; `src/connectors/lovable/policy.ts`; `src/cli/agent-registration.ts:114` (successor pattern)
