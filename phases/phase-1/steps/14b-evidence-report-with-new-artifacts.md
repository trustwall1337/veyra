# Step 14b — evidence-report agent composes new artifact set

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §10 step 14 row`
**Amends Phase 1 step:** 14
**Produces:** agent reshape at `src/agents/evidence-report/`
**Depends on:** 09b, 10b, 11b, 12b, 08d
**Executed by:** `/new-agent` skill (amendment mode)
**Verification:** control-card composition test against fixture; `--fail-on-blocker` driven by Findings only (AIConcerns never block)

## Goal

Reshape evidence-report to compose control cards from the new artifact set: `ScanFact[]` + `Hypothesis[]` + `Finding[]` + `AIConcern[]` + `assertions.json` audit trail. `controls.ts` catalog is unchanged. Readiness rules unchanged. `--fail-on-blocker` semantics unchanged (Findings drive the gate; AIConcerns are advisory).

## What lands

- `src/agents/evidence-report/agent.ts` — reads all four artifact types and the assertions audit. Composes `control-cards.json` and `readiness-report.json`.
- `src/agents/evidence-report/controls.ts` — canonical catalog. Per-control entry declares `required_evidence_kinds`, `owning_agent_ids`, and `phase_2_active_supported: boolean`. Unchanged from step 14 except that `evidence_kinds` references the four artifact types.
- `src/agents/evidence-report/readiness.ts` — same rule set as step 14 (Phase 1 rules; Phase 2 active-evidence rules added in step 10e of Phase 2). Pass-1/Pass-2 results are both inputs but the rules treat them per revision §4.2.
- Control cards now include a `ai_context` sub-section listing attached `supporting_hypothesis_refs` (when present) and an `ai_concerns_for_this_control` link to the relevant AIConcerns. Both are advisory; neither affects `readiness_status`.

## Done when

- Agent reads from artifact store only. No `import` from sibling agents.
- Each control card has shape per `FPP §9.3`: `control_id → expected_behavior → evidence_refs → findings → supporting_hypothesis_refs → ai_concerns_for_this_control → suggested_tests → readiness_status`.
- `--fail-on-blocker` exit code is non-zero iff any control card has `readiness_status: launch_blocker`. AIConcerns never contribute to this gate.
- Fixture integration: same `control-cards.json` shape as step 14 with the new fields populated when AI ran.

## Guardrails

- Per `REVISION_AI_SHAPE §10` evidence-report row: agent does not generate new findings of its own. It composes upstream output.
- Per constraints 1, 7, 9: AI never sets classification or readiness; AIConcerns never become Findings; the readiness rules are deterministic.
- Per `FPP §2A`: `controls.ts` is extensible — adding a new `control_id` is one new entry, no shape change.

## References

- `REVISION_AI_SHAPE.md` §10 step 14 row
- `phase-1/steps/14-agent-evidence-report.md` (original — was not done; this amendment supersedes it)
- 09b, 10b, 11b, 12b, 08d (upstream artifacts)
