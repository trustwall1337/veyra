# Step 21 — End-to-end fixture-run bug fixes (3 bugs discovered on first real scan)

**Status:** done (2026-05-25)
**Maps to:** none of the planned sections directly — this is post-revision repair surfaced by the first real end-to-end run of `examples/vulnerable-lovable-supabase` on 2026-05-25. The bugs all sit in already-"done" steps (08b, 13b/14b, 18b) and indicate the fixture gate (19b) never actually ran end-to-end against the artifact directory the orchestrator writes — only against unit harnesses.
**Amends Phase 1 step:** none (no design change; pure bugfix to existing implementations)
**Produces:** code fixes only, no new artifacts or types
**Depends on:** 18b (orchestrator wire-up — `registerPhase1Agents` was hot-fixed during the test), 19b (the gate that should have caught these)
**Executed by:** plain coding pass + `step-reviewer` subagent at the end + a real fixture re-run as the verification command
**Verification:** `pnpm dev -- scan --project examples/vulnerable-lovable-supabase --schema examples/vulnerable-lovable-supabase/schema.sql --report fixture-report.md --no-ai` produces a `findings.json` with `findings.length > 0` AND the rendered report's "Declared project context" + "Observed evidence" sections cite the real artifacts instead of saying "No declared-context artifact was found" / "No evidence-inventory artifact was found." See §"Done when" for the precise gates.

## Goal

On 2026-05-25 we ran the first true end-to-end fixture scan with all seven Phase 1 agents wired into the orchestrator. The scan executed without errors, all seven agents reported `status: ok` in `scan-trace.json`, but the rendered report showed **0 findings across all 12 controls** and the executive summary said the inventory and declared-context artifacts were missing — despite both files being present in the scan's artifact directory. Three distinct bugs combined to produce this empty-report outcome. This step fixes all three so the next fixture run produces the expected non-empty `findings.json` and a report that cites its own artifacts.

This is not a design change. No artifact shape moves, no agent contract changes. The fixes are localised to: the tool-runner's output-path computation, the reporter's artifact-lookup paths, and the tool-runner's `coverage_gap` emission for missing scanner binaries.

## What lands

Four independent code fixes in one step (Bug 4 surfaced during the
verification re-run for Bugs 1–3 and is documented below for symmetry
with the others), plus one verification re-run.

### Bug 1 — tool-runner writes `scan-facts.json` to a nested scan_id directory

**Observed:** the scan's artifact directory is `.veyra/scans/<scan_id>/`. After the run, `scan-facts.json` was found at `.veyra/scans/<scan_id>/<scan_id>/scan-facts.json` — two `<scan_id>` segments deep. Every Pass-1 predicate that reads `path.join(context.artifactDir, 'scan-facts.json')` (wired in `src/cli/agent-registration.ts:74,82`) reads an empty file and emits zero findings. This is the root cause of the 0-findings outcome for cc-11-3, cc-11-4, cc-11-7, cc-11-8, cc-11-9, cc-11-10, cc-11-11.

**Where to fix:** `src/agents/tool-runner/`. Find where the tool-runner computes its output path and stop appending `scan_id` to an `artifactDir` that already contains it. The orchestrator already hands each agent a per-scan `artifactDir`; the agent's responsibility ends at writing `scan-facts.json` into that directory unmodified.

**Done when:** the file lands at `.veyra/scans/<scan_id>/scan-facts.json` exactly, and a fresh fixture run shows authn / authz-tenant / supabase-rls / business-logic predicates reading non-empty facts (verify by checking `findings.length > 0` in `findings.json` and at least one predicate's findings cite a real fact_id from `scan-facts.json`).

### Bug 2 — reporter cannot find `inventory-bootstrap.json` and `declared-context.json`

**Observed:** `inventory-bootstrap.json` (2.8KB) and `declared-context.json` (3.2KB) were both written to the scan's artifact directory by the bootstrap-inventory composer (17b) and declared-context-builder composer (17c). The rendered `fixture-report.md` says "No declared-context artifact was found for this scan." and "No evidence-inventory artifact was found." So the evidence-report composer (14b) or its rendered output (13b) is looking under the wrong filename or path.

**Where to fix:** `src/agents/evidence-report/` and/or `src/reporters/markdown/`. Audit every artifact-lookup path in the report-rendering chain. Either the filenames diverged across steps (composer writes `inventory-bootstrap.json` but reporter reads `evidence-inventory.json`) or the path resolution doesn't use `context.artifactDir`.

**Done when:** the rendered report's "Declared project context" section shows the real declared `purpose`, `user_roles`, and `data_kinds` from `declared-context.json`, and the "Observed evidence" section either embeds or cross-links to `inventory-bootstrap.json` content (routes, dependencies, file-evidence summaries) instead of saying the artifact was missing.

### Bug 3 — tool-runner does not emit `coverage_gap` for missing scanner binaries

**Observed:** the test machine has `semgrep` installed at `/opt/homebrew/bin/semgrep` but neither `gitleaks` nor `osv-scanner` are on PATH. The tool-runner should emit a `coverage_gap` ScanFact for each missing scanner so the report can surface "cc-11-8 was not checked because gitleaks is not installed" — a `needs_review` with a real reason, not a silent gap. Bug 1 hides whatever the tool-runner emitted (or didn't), so this is currently unobservable from the report.

**Where to fix:** `src/agents/tool-runner/` — confirm that missing-scanner detection emits a `coverage_gap` ScanFact tagged to the control(s) the missing scanner covers. If the tool-runner already does this, the bug is that Bug 1 destroyed the output; once Bug 1 is fixed the coverage_gap facts should reach the report. If the tool-runner does NOT do this, add the emission.

**Done when:** with gitleaks and osv-scanner absent from PATH, the report shows cc-11-8 and cc-11-10 as `needs_review` with an uncertainty note that names the missing scanner ("gitleaks not on PATH; secret-scan coverage gap"). Wording follows the allowed-claims list (CLAUDE.md §Output language) — "checked" / "found" / "missing" only.

### Bug 4 — orchestrator topo-sort never sequences agents

**Observed:** during the verification re-run for Bugs 1–3, every agent
landed in `layer 0` of `scan-trace.json`, meaning all seven ran
concurrently. The aggregator (`evidence-report`) read its upstream
`resultsByAgent` BEFORE any peer agent had finished, so it composed
control cards with `findings: []` even after Bugs 1 + 2 were fixed.
The root cause is that agents declare their dependencies by ARTIFACT
basename (`'scan-facts.json'`, `'declared-context.json'`) but the
orchestrator's `topoLayers` only matches them against AGENT IDs. With
no matches, every agent had zero incoming dependencies → all in
layer 0 → no sequencing.

**Where to fix:** `src/types/agent.ts` (`AgentMetadata.produces`) +
`src/core/orchestrator/scan-orchestrator.ts` (`topoLayers`). Add a
`produces?: readonly string[]` field to `AgentMetadata` so each agent
declares which artifact basenames it writes. `topoLayers` then
resolves an artifact-name dependency to its producer's agent id. The
special value `'*'` (already used by `evidence-report`) is recognised
as "depend on every other registered agent." Duplicate producers throw
a `CycleError` at registration time.

**Done when:** `scan-trace.json` shows ≥ 2 layers (one for producers,
one for predicate consumers, one for aggregator); `evidence-report` is
always in the last layer; the fixture run produces a non-empty
`control_cards.findings[]` across the seeded controls.

## Done when

All three bugs are fixed and a single fresh fixture run satisfies:

1. **Findings present:** `findings.json` has `length > 0`. At least one finding is attributed to each of: authn predicate, authz-tenant predicate, supabase-rls predicate, business-logic predicate (i.e. all four Pass-1 predicate agents produced something against the seeded fixture).
2. **Schema-driven findings fire:** because the schema has seeded RLS-off patterns and broad `USING (true)` policies (per `04-vulnerable-fixture.md`), the supabase-rls predicate emits at least one finding for cc-11-5 and one for cc-11-6 — these don't need any external scanner binary.
3. **Report cites its own artifacts:** the rendered report's "Declared project context" section quotes real declared context (not "No declared-context artifact was found"), and "Observed evidence" cross-links the bootstrap inventory.
4. **Coverage gaps are surfaced explicitly:** controls covered by an uninstalled scanner show `needs_review` with an uncertainty note naming the missing scanner. No silent gaps.
5. **Verification command (above) re-run produces all four gates green and `pnpm typecheck` + `pnpm test` stay clean.**
6. **19b gate runs end-to-end against the orchestrator's real output**, not just against unit harnesses. If 19b's `/scan-fixture` skill (or whatever wraps the gate) bypasses the orchestrator, fix that as part of this step or open a follow-up step explicitly.

## Failure modes and what they mean

- **Findings still 0 after the tool-runner path fix.** Either the predicates are reading a wrong path key, or `scan-facts.json` is being written empty (semgrep returned no rules-matched). Verify by reading the file content directly before blaming the predicates.
- **Report still says "no declared-context artifact found" after the reporter fix.** The composer might be writing under one name and the reporter reading under another; grep both sides for the filename literal.
- **`coverage_gap` ScanFacts appear in `scan-facts.json` but not in the report.** Pass-1 isn't routing `coverage_gap` to the control card. This is a report-rendering issue, not a tool-runner issue.
- **The fixture run still produces a needs_review for a control where the schema clearly violates it (e.g. cc-11-6 with a `USING (true)` policy on a sensitive table).** The supabase-rls predicate's schema parsing is broken — not a Bug-1 path issue.

## Guardrails

- Do NOT change any artifact's schema, name, or location while fixing this. The shapes are the contracts of steps 02b/08b/17b/17c/14b — fix the writer or reader to match the contract, not the contract.
- Do NOT add new findings or controls to the catalog. This step fixes plumbing, not detection.
- Do NOT skip the `step-reviewer` review just because this is "a small bugfix" — three bugs slipped past 19b precisely because end-to-end gating was assumed instead of verified. The reviewer catches that.
- Do NOT install gitleaks or osv-scanner on the user's machine as part of this step. Bug 3 is about emitting a `coverage_gap` when they're absent — the missing-binary path IS the path under test here.
- Per CLAUDE.md §Output language: the uncertainty note for a missing scanner must say "not on PATH" / "coverage gap" — never "the scan is not secure" or "the scan is incomplete."
- Per CLAUDE.md §Extensibility-first: do NOT special-case the scanner names (`'gitleaks' | 'osv'`) anywhere in core/. Missing-binary detection is a property of the scanner adapter (one folder per service), not a switch in shared code.

## References

- The artifact-directory snapshot showing the nested-scan_id path: `.veyra/scans/2026-05-25T12-51-15-771Z-9e41622d/2026-05-25T12-51-15-771Z-9e41622d/scan-facts.json` (created by the 2026-05-25 fixture run; safe to delete after the fix lands).
- The empty report from the same run: `fixture-report.md` at repo root, all 12 controls `needs_review` with 0 findings — captured snapshot of the broken behaviour.
- `phases/phase-1/steps/08b-tool-runner-scan-facts-migration.md` — the tool-runner contract that Bug 1 violates.
- `phases/phase-1/steps/14b-evidence-report-with-new-artifacts.md` and `phases/phase-1/steps/13b-reporter-three-tier-rendering.md` — the reporter contracts that Bug 2 violates.
- `phases/phase-1/steps/19b-fixture-gate-three-tier-and-assertion-replay.md` — the gate that should have caught all three; needs to be re-verified end-to-end as part of this step's Done-when §6.
- `src/cli/agent-registration.ts` — the wire-up confirming each predicate reads `path.join(context.artifactDir, 'scan-facts.json')`; tool-runner must write to the same path with no extra segment.
