# Step 19 — End-to-end fixture validation gate

**Status:** done (2026-05-25)
**Maps to:** `PHASE_1_PLAN §8` success criteria
**Produces:** verification only (no new code)
**Depends on:** 18
**Executed by:** `/scan-fixture` command (+ `output-language-lint` subagent)
**Verification:** all 12 `FINAL_PRODUCT_PLAN §11` checks surface (matched by `control_id`); 2 seeded clean tables produce no findings; report passes language lint

## Goal

The gate that says "Phase 1 is done." No new code. Run the full pipeline against the fixture from step 04 and confirm everything the success criteria require. All assertions key off `control_id` from step 14's canonical `controls.ts` catalog — never duplicate or rename a control name here.

## What lands

- Nothing new. This is a verification pass.

## Done when

- `/scan-fixture` reports:
  - Every entry in `expected-findings.json::must_surface` IS in the scan output, matched by `control_id`
  - Every entry in `expected-findings.json::must_not_surface` is NOT in the scan output
  - Zero unexpected findings (i.e. no findings beyond `must_surface`)
  - MCP-dependent findings are skipped when their connector is not configured (counted as `coverage_gap`, not failure)
- `output-language-lint` subagent run on the generated `veyra-report.md` returns zero hits.
- `--fail-on-blocker` correctly exits non-zero on the fixture (which has at least one §11.5 RLS-off `likely_issue + high + fix_before_launch` that computes to `readiness_status: launch_blocker`).
- The report renders all `FINAL_PRODUCT_PLAN §9` sections, including a non-empty Sources / Scanner metadata section that explicitly lists scanners run, scanners missing, and resulting coverage gaps per `control_id`.

## Failure modes and what they mean

- Missing finding from `must_surface`: the corresponding agent or rule has a gap. Trace via `control-cards.json` → upstream agent → fix.
- Unexpected finding: false positive. Fix the heuristic or rule, not the fixture.
- Language lint hit: a string somewhere uses forbidden vocabulary. Fix the string, not the lint.
- Non-deterministic output (snapshot diff between runs): an agent or reporter has hidden state. Identify and fix.
- `expected-findings.json` references a `control_id` not in `controls.ts`: drift between fixture and canonical catalog. Fix the fixture.

## Guardrails

- Do NOT loosen the fixture to make findings "pass." If a heuristic doesn't catch a planted issue, the heuristic is wrong.
- Do NOT widen the language lint allowlist to silence hits. The §9 vocabulary is non-negotiable.
- Do NOT mark a finding as `confirmed_issue` to satisfy a "must surface" check unless evidence is direct and §5 classification rules allow it.
- Do NOT rename a `control_id` in `controls.ts` without also updating `expected-findings.json` and `.claude/commands/scan-fixture.md` in the same commit.

## References

- `PHASE_1_PLAN.md` §8 (Success criteria), §9 (non-claims)
- `FINAL_PRODUCT_PLAN.md` §11 (12 initial checks)
- Step 14 `controls.ts` (canonical `control_id` catalog)
- `.claude/commands/scan-fixture.md`
- `.claude/agents/output-language-lint.md`
- Step 04 fixture
