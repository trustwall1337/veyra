# Step 11 — Authz / tenant-boundary agent

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 11`, §4.3
**Produces:** `src/agents/authz-tenant/`
**Depends on:** 02, 04, 08, 09
**Executed by:** `/new-agent` skill (+ `write-finding` skill)
**Verification:** integration test against fixture; defensive-read test when `supabase-tables.json` missing (→ `coverage_gap`)

## Goal

Identify likely authorization and tenant-isolation gaps. Cross-references Semgrep findings (route patterns), Supabase RLS parser output (which tables are sensitive), and the project's data-access call sites.

## What lands

- `src/agents/authz-tenant/agent.ts` — implements `VeyraAgent`.
- `src/agents/authz-tenant/heuristics.ts`:
  1. Direct-object-access pattern (e.g. `select * from <table> where id = req.params.id`) on a sensitive table from `supabase-tables.json` with no user/tenant clause → `likely_issue`, `blast_radius: tenant_data | user_data`
  2. Query that uses client-provided `tenant_id` / `org_id` / `workspace_id` from a request body or query param → `likely_issue`
  3. Sensitive-route handler with no associated negative-test file (`*.test.ts` checking 403/forbidden) → `coverage_gap` with `suggested_tests`
- Reads upstream artifacts: `scanner-findings.json` (step 08), `supabase-tables.json` (step 09).
- Test fixtures in `src/agents/authz-tenant/__fixtures__/`.

## Done when

- `/new-agent` skill checklist all green.
- Fixture's direct-object-by-id and client-tenant_id patterns each produce a finding.
- Missing `supabase-tables.json` (e.g. step 09 failed) results in a `coverage_gap` for tenant-isolation checks, NOT a crash. Defensive-read test covers this.
- `suggested_tests` on coverage_gap findings name the missing negative test (e.g. "GET /api/orders/:id as user_b should return 403").
- `output-language-lint` clean.

## Guardrails

- Per §4.3: "Confirm only when evidence is direct. Otherwise classify as `likely_issue`, `coverage_gap`, or `missing_evidence`." No `confirmed_issue` from heuristics.
- Agent reads upstream artifacts; never imports from `src/agents/supabase-rls/` or `src/agents/tool-runner/`.
- Suggested tests use the §9 vocabulary ("negative tests should be added"), not "secure" / "compliant".

## References

- `PHASE_1_PLAN.md` §4.3 (Authz/tenant controls), §7 Task 11
- `FINAL_PRODUCT_PLAN.md` §11 (checks 3, 4)
- `.claude/skills/new-agent/SKILL.md`, `.claude/skills/write-finding/SKILL.md`
- Step 04 fixture, step 08 + 09 artifacts
