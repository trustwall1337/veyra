# Step 11b — authz-tenant as deterministic assertion predicate

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §10 step 11 row, §4.1 Pass-1 rule`
**Amends Phase 1 step:** 11
**Produces:** agent reshape at `src/agents/authz-tenant/`
**Depends on:** 08b, 09b, 10b
**Executed by:** `/new-agent` skill (amendment mode)
**Verification:** predicate-pure-on-facts; cc-11-3 / cc-11-4 / cc-11-9 finding emission; reads `scan-facts.json` (not `scanner-findings.json`)

## Goal

Reshape authz-tenant into a deterministic assertion predicate over Semgrep + Supabase-schema + declared-context facts. Emits `Finding[]`. **Never reads `hypotheses.json`.**

## What lands

- `src/agents/authz-tenant/agent.ts` — reshape to `AssertionPredicate` shape per control.
- `src/agents/authz-tenant/predicates/`:
  - `cc-11-3-direct-object-access.ts` — fires on Semgrep facts (`rule_id` matching direct-object-access patterns) on routes hitting tables flagged as sensitive in step 09b's `supabase-tables.json`-equivalent.
  - `cc-11-4-client-tenant-id.ts` — fires on Semgrep facts where a query consumes a client-provided `tenant_id` / `org_id` / `workspace_id` from request body or query params.
  - `cc-11-9-cross-tenant-write-risk.ts` — fires on combined schema (all-authenticated policy) + route (write endpoint) facts.
- Defensive read of step 09b's `supabase-tables.json`-equivalent: if absent, predicates emit `coverage_gap` rather than crashing.

## Done when

- Agent signature confirms `AssertionPredicate` shape.
- Fixture integration: cc-11-3 + cc-11-4 + cc-11-9 each fire on their seeded patterns.
- Missing supabase-tables artifact → `coverage_gap` per predicate.
- Reads `scan-facts.json` and step 09b's output, **not** the deprecated `scanner-findings.json`.
- Constraint 10 enforced.

## Guardrails

- **Constraint 10:** facts-only Pass-1.
- Per `REVISION_AI_SHAPE §4.3` controls: confirms only when evidence is direct. `confirmed_issue` is reachable only via Phase 2 `proven_allowed` (Pass-2 in orchestrator, never here).
- Suggested tests use the §9 vocabulary ("negative tests should be added"), per `output-language-lint`.
- Per `FPP §2A`: predicates address controls by id, not by service name.

## References

- `REVISION_AI_SHAPE.md` §4.1, §10
- `phase-1/steps/11-agent-authz-tenant.md` (original — was not done; this reshape supersedes it)
- 08b, 09b
