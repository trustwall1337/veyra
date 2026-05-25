# Step 14 — Evidence and report agent

**Status:** done (2026-05-25)
**Maps to:** `PHASE_1_PLAN §7 Task 13`, §4.7; `FINAL_PRODUCT_PLAN §9.3` control cards
**Produces:** `src/agents/evidence-report/`
**Depends on:** 02, 13
**Executed by:** `/new-agent` skill (+ `write-finding` skill for any wrap-up findings)
**Verification:** integration test asserting control-cards.json structure + `--fail-on-blocker` exit-code test covering both `confirmed_issue` and high-confidence `likely_issue` blockers

## Goal

Compose control cards from all upstream agent findings, compute `readiness_status` per control, invoke the two reporters, drive the `--fail-on-blocker` exit code.

`controls.ts` is the **canonical control catalog** for all of Phase 1. Step 04 (fixture), step 19 (validation gate), and `.claude/commands/scan-fixture.md` all reference `control_id`s that originate here.

## What lands

- `src/agents/evidence-report/agent.ts` — implements `VeyraAgent`. Reads every upstream agent's findings from the artifact store, joins them to control definitions, builds `ControlCard[]`.
- `src/agents/evidence-report/controls.ts` — the canonical control catalog. Each entry has:
  - `control_id` matching `FINAL_PRODUCT_PLAN §11` numbering. Format is `cc-11-N` (kebab, dashes — NOT dots). Example: `cc-11-5` for RLS disabled on a sensitive table.
  - `expected_behavior` — single-sentence description
  - `required_evidence_kinds` — which `EvidenceKind` sources can support this control
  - `owning_agent_ids` — which agents are expected to produce findings against this control
- `src/agents/evidence-report/readiness.ts` — pure function `computeReadiness(controlCard) → readiness_status` with explicit rules:
  - Any `confirmed_issue` with `review_action: fix_before_launch` → `launch_blocker`
  - Any `likely_issue` with `evidence_strength: high` AND `review_action: fix_before_launch` → `launch_blocker`
  - Any `coverage_gap` AND no contradicting evidence → `needs_review`
  - At least one supporting evidence item and no blocker / no unresolved gap → `evidence_present`
  - `proven_in_sandbox` is reserved (Phase 2)
- Output artifacts: `control-cards.json`, `readiness-report.json`, plus the rendered `veyra-report.md` and `veyra-report.json` (via step 13 reporters).

## Done when

- `/new-agent` skill checklist all green.
- Each control card has the §9.3 shape: `control_id → expected_behavior → evidence_refs → findings → suggested_tests → readiness_status`.
- `readiness_status` is computed deterministically per the rules above. Unit tests cover each rule.
- `--fail-on-blocker` exit code is non-zero iff any control card has `readiness_status: launch_blocker` (covers both `confirmed_issue + fix_before_launch` AND high-confidence `likely_issue + fix_before_launch` — the latter is critical because Phase 1 heuristics emit `likely_issue` by design).
- AI-generated statements (none in Phase 1) would carry `confidence` and `uncertainty_notes` per §4.7 — type is in place even if no AI runs.
- `controls.ts` has an entry for every §11 check the fixture seeds; `expected-findings.json` and `.claude/commands/scan-fixture.md` use the same `control_id`s.
- `output-language-lint` clean.

## Guardrails

- Per §4.7: "Every finding must include evidence or an explicit `missing_evidence` label."
- Per §4.7: "Every AI-generated statement must include confidence and uncertainty."
- Agent must not generate new heuristic findings of its own. It composes upstream output; it does not re-classify.
- Agent reads from artifact store only. No `import` from sibling agents.
- The readiness-computation rules above are non-negotiable for Phase 1. If a control needs a different rule, add a new `readiness_status` value — don't fold special cases into existing values.
- `--fail-on-blocker` gating off `confirmed_issue` only would silently let Phase 1 heuristic findings through. The `likely_issue + high + fix_before_launch` rule prevents that.

## References

- `PHASE_1_PLAN.md` §4.7 (Evidence and report controls), §7 Task 13
- `FINAL_PRODUCT_PLAN.md` §9.3 (Control cards), §10 (finding model — Phase 1 §5 takes precedence on enums), §11 (canonical control IDs)
- `.claude/skills/new-agent/SKILL.md`
- Step 13 reporters
- Step 04 fixture (must reference same `control_id`s)
