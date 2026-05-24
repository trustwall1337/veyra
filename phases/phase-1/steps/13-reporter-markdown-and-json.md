# Step 13 — Markdown and JSON reporters

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 13`, §4.7, §5; `FINAL_PRODUCT_PLAN §9` report sections
**Produces:** `src/reporters/markdown/`, `src/reporters/json/`
**Depends on:** 02
**Executed by:** plain coding pass (pure functions — no skill needed)
**Verification:** snapshot tests + `output-language-lint` subagent must return zero forbidden-word hits + exhaustive `EvidenceKind` renderer test

## Goal

Pure rendering. Read the full artifact set, output Markdown and JSON. No scanner invocation, no agent logic. Determinism is guaranteed at this layer.

Renders evidence by its source kind so the report makes the trust gradient visible — static code vs MCP context vs scanner output vs (future) active validation.

## What lands

- `src/reporters/markdown/reporter.ts` — single entry point: `render(readinessReport, outputPath)`.
- `src/reporters/markdown/sections/` — one file per report section (per `FINAL_PRODUCT_PLAN §9`):
  - executive summary
  - declared project context
  - observed evidence
  - launch blockers
  - findings
  - control cards
  - suggested tests
  - uncertainty notes
  - sources and scanner metadata (see below — first-class section)
- `src/reporters/markdown/evidence/` — **one renderer per `EvidenceKind`**:
  - `static-code.ts` — renders `file:line` references with code snippet (redacted if contains secret-like patterns)
  - `mcp-context.ts` — renders `{ server, tool, request_fingerprint }`, labelled "declared (not verified)"
  - `scanner.ts` — renders `{ scanner, finding_id }` with link to scanner-findings artifact
  - `active-validation.ts` — Phase 2 placeholder; Phase 1 renders "not run in this scan"
  - `cleanup-proof.ts` — Phase 2 placeholder
- `src/reporters/json/reporter.ts` — emits the `ReadinessReport` shape as a stable JSON file.
- `src/reporters/markdown/strings.ts` — every user-facing string. This is the file `output-language-lint` scans.
- Snapshot tests under `src/reporters/markdown/__snapshots__/` covering: clean report, report with launch blockers, report with only coverage gaps, report with mixed evidence kinds.

### Sources and scanner metadata section (first-class)

Must show:
- Which scanners were available and ran, with version (gitleaks, OSV, semgrep)
- Which scanners were missing/skipped, with reason
- Which MCP connectors were enabled, with declared scope; which were not, with reason
- The `ValidationPolicy` summary: mode, environment, allowed_actions count
- Command-line args used (redacted of secret-like substrings)
- **Coverage implication**: which `control_id`s lost evidence due to missing tools or disabled MCP

This is the section that lets the user see "we checked X with full evidence, Y with partial evidence, Z not at all" without inferring it from finding counts.

## Done when

- Rendering the fixture's full artifact set produces a stable `veyra-report.md` and `veyra-report.json`.
- `output-language-lint` subagent returns zero hits.
- Snapshot tests pass.
- Exhaustiveness test fails the build if a new `EvidenceKind` is added without a renderer.
- The report explicitly distinguishes deterministic findings from AI-enriched explanations (per `PHASE_1_PLAN §3 Step 4`). Phase 1 has no AI explanations — section present but empty.
- The Sources section explicitly lists missing scanners, disabled MCP connectors, and the resulting coverage gaps per `control_id`.

## Guardrails

- Every string passes `output-language-lint`. Forbidden words: "secure," "safe," "compliant." Allowed vocabulary only per §9.
- Findings rendered with classification (`likely_issue`, `coverage_gap`, etc.) prominently. Never elide classification to make findings look definitive.
- No rendering treats the app as "vulnerable" — always frame as "appears launch-blocking" / "needs human review" per §9.
- MCP-derived evidence is labelled "declared (not verified)" — never presented as code-level proof.
- Reporters are pure functions: same input → same output, byte-for-byte. Snapshot tests enforce.
- No reporter reads from disk except via the artifact store passed as input. No network calls.
- Secret-like patterns in code-snippet rendering must be redacted before persisting to the report.

## References

- `PHASE_1_PLAN.md` §4.7 (Evidence and report controls), §5 (finding model), §7 Task 13, §9 (non-claims)
- `FINAL_PRODUCT_PLAN.md` §9 (report sections), §9.3 (control cards)
- `.claude/agents/output-language-lint.md`
- Step 02 `EvidenceKind` discriminated union
