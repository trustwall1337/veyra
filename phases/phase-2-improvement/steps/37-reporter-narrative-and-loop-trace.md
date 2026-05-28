# Step 37 — Reporter: narrative section + per-control cards + loop-trace summary

**Status:** done (2026-05-28) — agentic report renderer landed (narrative → root-cause → cards → active → gaps → trace; output-language-lint clean; fallback marker rendered)
**Maps to:** `PLAN.md §G` (AMEND reporter), `§M` (report shape)
**Phase:** 3, Cut 2
**Produces:** reporter extension (`src/reporters/markdown/`) rendering the authored narrative ABOVE the per-control cards, plus a loop-trace summary section; prefers `narrative.json` over legacy `ai-enrichments.json` when both exist.
**Depends on:** 35, 36
**Executed by:** plain coding pass + `output-language-lint` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; snapshot tests show: (a) narrative section + root-cause synthesis at the top; (b) per-control cards retained below as the audit appendix; (c) a loop-trace summary (tools called, denials, result-rejects, budget consumed); (d) `narrative.json` preferred when both it and `ai-enrichments.json` exist; (e) `output-language-lint` zero hits on the rendered report.

## Goal

The report stops being a per-control grid and becomes an authored security review: narrative + root-cause synthesis at the top, deterministic per-control cards beneath as the audit trail, and a loop-trace summary so the operator sees what the AI did. The narrative is the citation-linted output from Step 36.

## What lands

- Reporter renders: Narrative → root-cause synthesis → per-control cards → active outcomes → coverage gaps → loop-trace summary.
- `narrative.json` precedence over legacy `ai-enrichments.json` (deprecation window).
- Snapshot tests + `output-language-lint`.

## Done when

All Verification assertions pass. The fixture report shows an authored narrative atop the cards; lint clean.

## Guardrails

- Per CLAUDE.md §Output language: whole report through `output-language-lint`.
- Per-control cards retained (audit appendix), not removed.
- `--no-ai` renders a deterministic fallback narrative (templated, thinner) — never an empty narrative section.

## References

- `PLAN.md §G`, `§M`; `src/reporters/markdown/reporter.ts`, `sections/phase2-sections.ts`, `sections/ai-concerns.ts`
