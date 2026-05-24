# Step 09 — Supabase schema parser + supabase-rls agent

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 6`, §4.4; `FINAL_PRODUCT_PLAN §11` checks 5, 6, 9, 12
**Produces:** `src/agents/supabase-rls/` including the schema parser
**Depends on:** 02, 04
**Executed by:** `/new-agent` skill (+ `write-finding` skill for each emitted finding)
**Verification:** parser unit tests + integration test against fixture's `supabase/schema.sql`; mock-MCP test for bucket detection; `output-language-lint` clean

## Goal

Highest-signal Phase 1 agent. **Two evidence paths**:

- **Schema path** — parse `--supabase-schema` SQL for table-level RLS, policies, grants.
- **MCP path** — read `storage-buckets.json` artifact (from step 16) for bucket public/private state. Bucket state is NOT in `schema.sql` because Supabase db dumps exclude the `storage` schema.

Regex/line-based parser (not `pgsql-parser`) — fixture surface is controlled and a heavy Wasm dep isn't justified yet. Limits of the parser are documented; complex policies route to `manual_review_required` rather than silent failure.

## What lands

### Schema parser (`src/agents/supabase-rls/parser.ts`)

**Supported patterns (deterministic):**
- `ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;`
- `CREATE POLICY <name> ON <table> FOR <op> [TO <role>] USING (<expr>) [WITH CHECK (<expr>)];`
- `GRANT <privileges> ON <table> TO <role>;`
- Simple `USING (...)` expressions: literal `true`, `auth.uid() = <col>`, `<col> = current_setting(...)`, `<col> IN (...)`

**Known misses (documented, not silently ignored):**
- Policies with nested CTEs
- Policies calling user-defined functions whose body isn't inlined in the dump
- Conditional `DO $$ ... $$` blocks
- Policies defined across multiple statements
- Schemas other than `public` (Phase 1 limit)

For each unparseable policy, the parser emits a `manual_review_required` finding referencing the source line range — never silent.

### Heuristics (`src/agents/supabase-rls/heuristics.ts`)

Classifies parser output. **Evidence strength is differentiated by match confidence:**

- **Exact-name match** on the canonical sensitive-table list (`users`, `accounts`, `orders`, `tenants`, `invoices`, `payments`, `customers`, `subscriptions`) → `evidence_strength: high`. These names are unambiguous; if RLS is off on a table called `orders`, the launch-blocking conclusion is well-supported.
- **Pattern match** on a heuristic regex (`*_secrets`, `*_pii`, `*_private`, `*_admin`, `*_audit`) → `evidence_strength: medium`. Pattern-only matches may catch lookup tables or legacy naming.

Findings:
- **§11.5** Sensitive table WITHOUT `ENABLE ROW LEVEL SECURITY` → `likely_issue`, `review_action: fix_before_launch`, `blast_radius: user_data | tenant_data`. Strength per the rule above.
- **§11.6** `CREATE POLICY ... USING (true)` on sensitive table → `likely_issue`, same strength rule.
- **§11.9** Policy granting all rows to `authenticated` role without per-row check → `likely_issue`, same strength rule.

This matters because step 14's readiness rule promotes `likely_issue + evidence_strength: high + fix_before_launch → launch_blocker`. An RLS-off finding on a canonical-name table (e.g. fixture's `orders`) therefore triggers `--fail-on-blocker` as step 19's gate expects. Pattern-only matches stay at `needs_review`.

### Bucket-detection path (`src/agents/supabase-rls/buckets.ts`)

- Reads `storage-buckets.json` artifact from step 16's Supabase MCP connector.
- **§11.12** Public bucket with `select` granted to `anon` → `likely_issue`, `blast_radius: private_files`
- If `storage-buckets.json` is missing (Supabase MCP not configured), emit `coverage_gap` for §11.12 with the message: "Supabase MCP not configured; storage bucket state was not checked. Pass `--supabase-mcp <project_ref>` to enable."

### Agent (`src/agents/supabase-rls/agent.ts`)

- Implements `VeyraAgent`. Emits `supabase-tables.json` (table → metadata map) + bucket findings + parser findings.
- Tests: parser unit tests per supported pattern + edge cases; integration test against fixture schema; mock-MCP test for bucket path; coverage_gap test when MCP artifact missing.

## Done when

- `/new-agent` skill checklist all green.
- Every supported pattern has a positive AND a negative parser test.
- Every known miss produces a `manual_review_required` finding, not silent acceptance.
- Fixture's seeded patterns each produce the expected finding (referenced by `control_id` from §11).
- Seeded clean tables produce NO findings (false-positive control per §8).
- Public-bucket finding (§11.12) surfaces ONLY when MCP artifact is present; otherwise `coverage_gap`.
- Parser failure on malformed SQL emits `coverage_gap`, does not crash the agent.
- `uncertainty_notes` on every finding mention "regex parser; complex SQL may be missed" — honest disclosure per §4.4 controls.
- `output-language-lint` returns zero hits on emitted findings.

## Guardrails

- Agent must not connect to a real Supabase instance. Schema input is the SQL file; storage input is the MCP-derived artifact only.
- Findings are `likely_issue`, not `confirmed_issue`. Only the report agent can promote in narrow cases with direct evidence per §4.4.
- Do not query user data. Do not apply migrations. Do not change policies. (§4.4 controls verbatim.)
- The exact-name canonical list is `evidence_strength: high`. The pattern-regex matches are `evidence_strength: medium`. See the Heuristics section above for the rule. **Both lists are checked-in code, not inferred at runtime.** Adding a name to either list is a code change with a corresponding fixture update.
- **Storage bucket detection is MCP-only in Phase 1.** Do NOT attempt to infer bucket state from `schema.sql` — that data is structurally not there. (Source: Supabase CLI docs on `db dump`.)

## References

- `PHASE_1_PLAN.md` §4.4 (Supabase RLS controls), §7 Task 6
- `FINAL_PRODUCT_PLAN.md` §11 (checks 5, 6, 9, 12)
- Supabase CLI docs: `supabase db dump` excludes managed schemas (including `storage`)
- `.claude/skills/new-agent/SKILL.md`, `.claude/skills/write-finding/SKILL.md`
- Step 04 fixture schema + `mcp-fixtures/`
- Step 16 Supabase MCP connector (produces `storage-buckets.json`)
