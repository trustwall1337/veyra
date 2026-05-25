# Step 22 — Rewire the 19b fixture gate to run end-to-end against orchestrator output

**Status:** done (2026-05-25)
**Maps to:** none of the planned sections directly — surfaced by step 21's post-mortem on 2026-05-25. Step 19b's gate passes today because it tests building blocks (predicate purity, hypothesis disposition, markdown rendering shape) in isolation; the three bugs fixed in step 21 (nested-scanId path, reporter ignoring inventory + declared-context, coverage_gap not surfacing) all slipped through 19b because the gate never executed the orchestrator's real artifact-writing path.
**Amends Phase 1 step:** none (19b's contract stays; this step adds an end-to-end execution layer on top)
**Produces:** new test or `/scan-fixture` harness that runs the full CLI pipeline against `examples/vulnerable-lovable-supabase/` and asserts the artifact directory + report shape
**Depends on:** 18b (orchestrator wire-up), 19b (gate contract), 21 (the three bugfixes that motivate this gate)
**Executed by:** plain coding pass + `step-reviewer` subagent at the end
**Verification:** the new end-to-end test runs against the fixture under `pnpm test` (or under a dedicated harness), the orchestrator's emitted `readiness-report.json` contains non-empty findings (per the persistence layout: findings live inside `launch_blockers` + `control_cards[].findings`; there is no separate `findings.json` artifact in Phase 1), and the rendered Markdown report cites real declared-context + inventory content. Step-21's contract has the same persistence layout.

## Goal

Step 19b's four gates (three-tier rendering, --no-ai parity, expected AIConcerns surface, assertion-replay determinism) are tested via synthetic inputs and unit harnesses. None of them actually run the orchestrator against the fixture and read back what landed on disk. Step 21 surfaced three bugs that the gate could not catch:

1. The tool-runner wrote `scan-facts.json` to a nested `<scanId>/<scanId>/` path. Unit tests passed because they used the in-memory `ArtifactRef.path` field, not a separate disk lookup.
2. The reporter ignored `declared-context.json` and `inventory-bootstrap.json`. Unit tests passed because they fed synthetic `ReadinessReport` objects without exercising the post-orchestrator artifact-loading code path.
3. The tool-runner emitted `coverage_gap` Findings for missing scanners, but bug 1 hid them. The 19b synthetic gate didn't run with real scanners absent.

This step adds an end-to-end harness that runs the orchestrator (or the CLI command) against the fixture and asserts the on-disk artifact directory + rendered report meet the step 21 Done-when bullets — so a future regression in any of those three areas fails closed.

## What lands

- A new test (likely `src/cli/end-to-end-fixture.test.ts` or a `/scan-fixture` skill extension) that:
  - Invokes the full scan pipeline against `examples/vulnerable-lovable-supabase/` with `--no-ai` (no AI provider required).
  - Reads the resulting `.veyra/scans/<scanId>/findings.json`, asserts `findings.length > 0`, asserts at least one finding from each Pass-1 predicate (authn, authz-tenant, supabase-rls, business-logic).
  - Reads the resulting `.veyra/scans/<scanId>/scan-facts.json` and asserts it sits at the contracted path (no nested scanId segment).
  - Reads the resulting rendered `veyra-report.md` and asserts the "Declared project context" + "Observed evidence" sections cite real values (purpose, routes, deps) — not the "No declared-context artifact was found" placeholder.
  - Runs the scan a second time with no scanner binaries on `PATH` (mock the binary lookups or use a sandbox shim) and asserts cc-11-8 + cc-11-10 surface as `needs_review` with a coverage_gap finding that names the missing scanner.

## Done when

- The new end-to-end gate runs under `pnpm test` (or a documented separate `pnpm test:e2e` script if it's slow enough to warrant separation).
- Each of step 21's three bug classes (path-doubling, ignored-artifact, missing-scanner-coverage_gap) is covered by a specific assertion in the new gate. Re-introducing any of the three bugs (e.g. reverting step 21's `writeScanFactsArtifact` to the old store call) fails the gate closed.
- The 19b gate file is updated to reference this new step as the end-to-end companion to its synthetic gates.

## Guardrails

- Do NOT install gitleaks / osv-scanner / semgrep as a test prerequisite. The end-to-end test must work in environments where those binaries are absent. Either shim the subprocess runner via the existing `runners` injection seam, or run with the binaries genuinely absent and assert the `coverage_gap` path.
- Do NOT loosen any of 19b's four gates. This step ADDS a gate, it does not replace 19b's contract.
- Do NOT add hosted dashboards, Slack, PR comments, or autonomous remediation (FPP §18 / PHASE_1_PLAN §6 binding).
- Per CLAUDE.md §Output language: any new strings in the rendered report come from the allowed-claims vocabulary — "checked," "found," "missing," "appears launch-blocking," "needs human review."

## References

- `phases/phase-1/steps/19b-fixture-gate-three-tier-and-assertion-replay.md` — the synthetic gates this step complements.
- `phases/phase-1/steps/21-end-to-end-fixture-run-bugfixes.md` — the three bugs that motivated this step.
- `src/cli/scan-command.ts` — the CLI entry point the gate exercises.
- `src/cli/fixture-validation-gate.test.ts` — the existing fixture-validation harness; this step may extend it rather than create a new file, depending on what's cleaner.
