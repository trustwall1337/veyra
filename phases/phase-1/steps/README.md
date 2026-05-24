# Phase 1 — Step Files

These files are the executable breakdown of `phases/phase-1/PHASE_1_PLAN.md` into 20 ordered steps. They are derived from the phase-planner agent run (2026-05-24), the deep re-read pass against `FINAL_PRODUCT_PLAN.md`, and subsequent design-direction updates (validation-mode policy seam, AI-feedback review).

## Product framing

Phase 1's **implementation surface** is a scan runner + report generator. The CLI is the first delivery mechanism. Veyra's product identity is a **control-evidence graph** — not "a CLI" and not "a scanner."

## How to use these files

1. Steps are numbered `NN-<slug>.md` in execution order. Do them in order. Where `depends_on` is empty besides the immediate predecessor, you can parallelize cautiously.
2. Each file is self-contained: a future session should be able to pick up a step without re-reading the whole plan.
3. Each step names the **skill or subagent** that executes it. Prefer those over ad-hoc coding passes — they enforce conventions the trust model depends on.
4. Each step has a **Done when** criterion. Don't move on until it's met.

## Validation-policy model (added 2026-05-24)

Veyra is **not** designed as a binary `read_only=true/false` tool. From step 02 onward, the type system carries a `ValidationPolicy` object with three possible modes:

- `read_only_evidence` — Phase 1's only implemented mode. Safe for any environment including production. Reads code, schema metadata, storage metadata; never mutates.
- `sandbox_active_validation` — Phase 2 target. User opts in. Synthetic identities, synthetic data, controlled negative tests, mandatory cleanup. Only against `local | dev | preview | staging | sandbox` environments.
- `approved_production_safe` — Phase 3 target. Strict scope, explicit approval, rate-limited, no exploitation.

**Capability decisions consult `policy.allowed_actions.has('<action>')`, never `policy.mode === '...'`.** The mode is metadata for the report. The capability set is the authority. This means accidentally toggling `read_only=false` somewhere does NOT enable mutation — there is no such toggle.

## Hard rules (apply to every step)

- Output language obeys `PHASE_1_PLAN §9`: only "checked," "found," "missing," "appears launch-blocking," "needs human review," "negative tests should be added." Never "secure," "safe," "compliant."
- Heuristic findings are `likely_issue`, never `confirmed_issue` (per `PHASE_1_PLAN §5` finding model).
- Gitleaks always with `--redact`. No raw secret values in artifacts, logs, or reports.
- Lovable MCP: allowlist-only — `get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` (with `plan_mode`, fixed prompt templates only). Everything else forbidden.
- Supabase MCP: every call requires `read_only=true` (under `read_only_evidence` policy) AND `project_ref`. No mutating tools, no user-row queries, no `execute_sql`. Enforce in `src/core/policy/`, not just at startup.
- `PHASE_1_PLAN §6` and `FINAL_PRODUCT_PLAN §18` non-goals are binding. Stop and ask before adding hosted dashboards, Slack, PR comments, autonomous remediation, or compliance claims.

## Decisions taken by the planner (ratified in step 01)

- Test framework: **Vitest** (already pinned in `package.json`).
- CLI argv lib: **commander**.
- MCP SDK: **`@modelcontextprotocol/sdk`** (official).
- Supabase MCP `execute_sql`: **denied** in Phase 1 even under `read_only=true`. Rely on `list_tables` + `get_advisors` instead.
- Semgrep rules: **YAML rules + `semgrep --test`**. No LLM workflows in Phase 1.
- Supabase schema parser: **regex/line-based**. No `pgsql-parser` dep.
- AI provider: **interface only**, no live provider wired in Phase 1.
- Validation-policy seam: **types land in step 02; only `read_only_evidence` mode is wired in Phase 1.** Sandbox and approved-production modes are CLI-rejected with "not yet implemented."
- Lovable MCP `send_message`: **fixed prompt-template allowlist** in step 15 — no free-form text.
- Supabase storage bucket detection: **MCP-only** in step 09 — not derivable from `schema.sql` (Supabase `db dump` excludes the `storage` schema).
- `--fail-on-blocker` gate: **`readiness_status == launch_blocker`** in step 14 — covers both `confirmed_issue` and high-confidence `likely_issue` blockers.
- Canonical control catalog: **`src/agents/evidence-report/controls.ts`** (step 14). Step 04 fixture, step 19 gate, and `.claude/commands/scan-fixture.md` all reference `control_id`s from there.

## Research findings worth knowing

- Lovable MCP tool surface has grown well beyond `PHASE_1_PLAN §3 Step 1` (now includes `get_me`, `list_workspaces`, `list_projects`, `get_project_knowledge`, `list_mcp_servers`, `get_project_analytics`, `deploy_edge_function`, `get_file_upload_url`, etc.). Allowlist-only design auto-forbids them. Source: docs.lovable.dev (2026-05).
- Current Supabase MCP includes `execute_sql`, `apply_migration`, `deploy_edge_function`, branch tools. All forbidden in Phase 1 by `§4.4` controls.
- `@modelcontextprotocol/sdk` v1.29.0 has a known ESM resolution issue (#460). Fall back to hand-rolled JSON-RPC if it bites at step 02; cost is contained.
- Comparable scanners for Lovable apps already exist (2026-05): Vibe-Scanner, Symbiotic Security, securifyai's RLS Scanner, Lovable's own built-in. The 12-check list is **table stakes**, not differentiation. Differentiation comes from `FINAL_PRODUCT_PLAN §23` (control-evidence graph + allowed-claims vocabulary) AND the future Phase 2 sandbox active validation that proves controls rather than only observing them.
- Supabase CLI `db dump` excludes managed schemas (including `storage`). Public/private bucket state must come from MCP, not from SQL exports. Source: Supabase CLI docs.

## File index

| # | File | Title |
|---|---|---|
| 01 | `01-lock-blocking-decisions.md` | Lock blocking decisions (argv, MCP SDK, test framework ratification) |
| 02 | `02-foundation-types-artifact-store-policy.md` | Foundation — types (incl. `ValidationPolicy`), artifact store, policy guard, orchestrator skeleton |
| 03 | `03-cli-argv-and-dual-mode.md` | CLI argv (incl. `--mode`, `--env`, `--lovable-project`) + dual-mode scan entry |
| 04 | `04-vulnerable-fixture.md` | Vulnerable Lovable+Supabase fixture project (+ `mcp-fixtures/` for storage) |
| 05 | `05-scanner-gitleaks.md` | Gitleaks scanner adapter |
| 06 | `06-scanner-osv.md` | OSV-Scanner adapter |
| 07 | `07-scanner-semgrep-and-rules.md` | Semgrep adapter + custom rules |
| 08 | `08-agent-tool-runner.md` | Tool-runner agent |
| 09 | `09-agent-supabase-rls.md` | Supabase schema parser + supabase-rls agent (+ MCP bucket path) |
| 10 | `10-agent-authn.md` | Authn agent |
| 11 | `11-agent-authz-tenant.md` | Authz/tenant boundary agent |
| 12 | `12-agent-business-logic.md` | Business-logic agent |
| 13 | `13-reporter-markdown-and-json.md` | Markdown and JSON reporters (+ per-`EvidenceKind` rendering) |
| 14 | `14-agent-evidence-report.md` | Evidence and report agent (canonical `controls.ts` catalog) |
| 15 | `15-connector-lovable-mcp.md` | Lovable MCP connector (fixed `send_message` templates) |
| 16 | `16-connector-supabase-mcp.md` | Supabase MCP read-only connector (policy-driven) |
| 17 | `17-agent-product-understanding.md` | Product-understanding agent |
| 18 | `18-orchestrator-wiring-and-failure-isolation.md` | Orchestrator wiring + failure isolation |
| 19 | `19-fixture-validation-gate.md` | End-to-end fixture validation gate |
| 20 | `20-phase1-documentation.md` | Phase 1 documentation |
