# Step 10b — authn as deterministic assertion predicate

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §10 step 10 row, §4.1 Pass-1 rule`
**Amends Phase 1 step:** 10
**Produces:** agent reshape at `src/agents/authn/`
**Depends on:** 08b, 17c
**Executed by:** `/new-agent` skill (amendment mode)
**Verification:** predicate-pure-on-facts; cc-11-1 / cc-11-2 finding emission; `coverage_gap` when no relevant facts

## Goal

Reshape authn into a deterministic assertion predicate over Semgrep ScanFacts (`source.kind === 'scanner_match'`, `payload.rule_id` in the authn rule set) + declared context. Emits `Finding[]`. **Never reads `hypotheses.json`.**

## What lands

- `src/agents/authn/agent.ts` — reshape to `AssertionPredicate` signature per control.
- `src/agents/authn/predicates/`:
  - `cc-11-1-frontend-only-protection.ts` — fires when Semgrep facts show client-side `if (!user) redirect(...)` pattern AND no facts show a server-side check anywhere in the codebase.
  - `cc-11-2-admin-route-no-server-check.ts` — fires on admin-route facts with no role-check-function facts in the call graph.
- Each predicate is a pure function over a `ScanFact[]` slice + `declared-context.json`.

## Done when

- Agent signature confirms `AssertionPredicate` shape. No `Hypothesis[]` input.
- Fixture integration: cc-11-1 on the seeded frontend-only route → `Finding(likely_issue, fix_before_launch)`. cc-11-2 on the seeded admin route without server check → same.
- Missing relevant Semgrep facts (tool-runner didn't run, or Semgrep wasn't installed) → `coverage_gap` finding, not silent absence.
- Constraint 10 enforced.

## Guardrails

- **Constraint 10:** predicates are facts-only. AI absence does not weaken the baseline.
- Per `REVISION_AI_SHAPE §4.1`: Pass-1 only. AI corroboration attaches in Pass-2 (18b orchestrator), not here.
- Per `FPP §2A`: predicates dispatch on `rule_id` from the payload, not on `scanner_id` strings. Adding a new auth-pattern rule = new Semgrep rule + new predicate clause, no shared-type edits.

## References

- `REVISION_AI_SHAPE.md` §4.1, §10
- `phase-1/steps/10-agent-authn.md` (original — was not done; this reshape supersedes it)
- 07b (Semgrep facts source), 08b (consolidated facts)
