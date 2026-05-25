# Step 09b — supabase-rls as deterministic assertion predicate

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §10 step 09 row, §4.1 Pass-1 rule`
**Amends Phase 1 step:** 09
**Produces:** agent reshape at `src/agents/supabase-rls/`
**Depends on:** 08b, 17c
**Executed by:** `/new-agent` skill (amendment mode)
**Verification:** predicate-pure-on-facts test; cc-11-5 / cc-11-6 / cc-11-9 / cc-11-12 finding emission; constraint 10 (baseline-runs-on-facts) enforced

## Goal

Reshape the supabase-rls agent from "infer + classify" to "deterministic assertion predicate." It reads `scan-facts.json` (subset where `source.kind === 'schema_element'` or `source.kind === 'mcp_response'` with relevant connector) + `declared-context.json`. Emits `Finding[]` per the predicate rules. **Never reads `hypotheses.json`.**

## What lands

- `src/agents/supabase-rls/agent.ts` — reshape to implement `AssertionPredicate` signature: `(ScanFact[], DeclaredContext) → Finding | null` per control.
- `src/agents/supabase-rls/predicates/`:
  - `cc-11-5-rls-disabled.ts` — fires on sensitive-named tables (canonical list → `evidence_strength: high`; pattern match → `medium`) with no `ENABLE ROW LEVEL SECURITY`. Returns `Finding | null`.
  - `cc-11-6-broad-policy.ts` — fires on `USING (true)` or equivalent broad expressions.
  - `cc-11-9-all-authenticated.ts` — fires on policy granting all rows to `authenticated`.
  - `cc-11-12-public-bucket.ts` — fires on bucket facts (from `mcp_response` source with bucket-relevant tool) where `select` is granted to `anon`. Without bucket facts → `coverage_gap` finding, not silent absence.
- Each predicate is a pure function. Imports zero runtime state. Reads only its `ScanFact[]` slice + `declared-context.json`.
- Schema parser stays in `src/agents/supabase-rls/parser.ts` (regex-based, unchanged from step 09). It's used by 07b-equivalent for the schema-element ScanFacts, not at agent runtime.

## Done when

- Agent type signature confirms `AssertionPredicate` shape. `agent.run()` does not accept `Hypothesis[]` as input.
- Predicate-pure-on-facts test: feed the agent a `Hypothesis[]` it could read; assert no predicate uses it (compile-time + runtime).
- Fixture integration test: cc-11-5 on RLS-off canonical-name table → `Finding(likely_issue, high, fix_before_launch)`. cc-11-6 → `Finding(likely_issue)`. cc-11-9 → `Finding(likely_issue)`. cc-11-12 with bucket facts → `Finding`; without → `coverage_gap`.
- Constraint 10 enforced: removing AI from a scan does not change which findings this agent produces.

## Guardrails

- **Constraint 10:** predicates are facts-only. Type signature blocks hypothesis input.
- Per `REVISION_AI_SHAPE §4.1`: Pass-1 (predicates) runs before Pass-2 (hypothesis disposition in 18b). This agent is Pass-1 only.
- Per `FPP §2A`: predicates dispatch on `scanner_id` / `connector_id` / `parser_id` via the registry, not on raw provider names.
- Per `CLAUDE.md §TypeScript conventions`: no `any`, `Result<T, E>` for expected failures. Parser errors → `manual_review_required` finding.

## References

- `REVISION_AI_SHAPE.md` §4.1, §10
- `phase-1/steps/09-agent-supabase-rls.md` (original — was not done; this reshape supersedes it)
- 08b (scan-facts.json consumer contract)
