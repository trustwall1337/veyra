# Step 08b — Tool-runner schema migration (clean break, Option B)

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §9 step 08 row, migration Option B, §12 ordering`
**Amends Phase 1 step:** 08
**Produces:** amended agent at `src/agents/tool-runner/` + downstream rewires (10b authn, 11b authz-tenant, 14b evidence-report, fixture `expected-findings.test.ts`)
**Depends on:** 05b, 06b, 07b
**Executed by:** `/new-agent` skill (amendment mode) + plain coding pass for the consumer rewires
**Verification:** Vitest with injected fake `ScanFact[]` asserts consolidated `scan-facts.json`; one missing binary still produces `coverage_gap`; downstream tests build and pass

## Goal

Migrate the tool-runner agent from producing `scanner-findings.json` (Finding[]) to `scan-facts.json` (ScanFact[]). This is a **clean break** (Option B from revision §9) — the old artifact name disappears in the same revision cycle that updates every downstream consumer. No dual-write.

## What lands

- `src/agents/tool-runner/agent.ts` — aggregates `ScanFact[]` from the three scanner adapters (Gitleaks, OSV, Semgrep, all amended in 05b/06b/07b). No transformation; the adapter return shape IS the artifact shape.
- New artifact: `scan-facts.json`. Old artifact: `scanner-findings.json` is removed.
- Downstream rewires in this same step:
  - `phase-1/steps/10-agent-authn.md` references → updated to read `scan-facts.json` (the step 10 file itself is amended by 10b; the rewire here is in tool-runner's contract documentation).
  - `phase-1/steps/11-agent-authz-tenant.md` references → same.
  - `phase-1/steps/14-agent-evidence-report.md` references → same.
  - `examples/vulnerable-lovable-supabase/expected-findings.test.ts` → rewritten to drive off `scan-facts.json` (the fixture's expectation file shape is updated in 04b).

## Done when

- `scanner-findings.json` is no longer produced anywhere in the tree (grep + integration test).
- `scan-facts.json` is the only consolidated artifact from observation layer 2.
- Each scanner is still wrapped in its own try-boundary; one missing binary → `coverage_gap`-shaped result for that scanner, not whole-scan failure.
- Stderr from each scanner is still persisted to the artifact store, scrubbed for secret-like patterns first.
- Three named downstream consumers build green:
  - 10b authn predicate (lands after this step)
  - 11b authz-tenant predicate (lands after this step)
  - fixture `expected-findings.test.ts` (touched in 04b)

## Guardrails

- **Status rollback:** the original step 08 file's `Status: done` rolls back to `not started`. The artifact rename is a contract change, not a surgical edit.
- Per `REVISION_AI_SHAPE §9` Option B: no dual-write window. Old artifact gone, new artifact in place, all consumers updated in the same revision cycle.
- Per `CLAUDE.md §FPP §2A`: tool-runner does not switch on scanner-name strings. It iterates the registered scanner adapters from the service registry.
- Tool-runner does NOT do security reasoning beyond normalisation. Finding emission is in the assertion layer (09b–12b).

## References

- `REVISION_AI_SHAPE.md` §9 step 08 + migration option choice
- `phase-1/steps/08-agent-tool-runner.md` (original — `Status: done`, rolls back to `not started`)
- 05b, 06b, 07b (the scanners this aggregates from)
