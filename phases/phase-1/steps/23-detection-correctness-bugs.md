# Step 23 — Detection-correctness bugs surfaced by step 22's end-to-end gate

**Status:** done (2026-05-25)
**Maps to:** none of the planned sections directly — surfaced by step 22's first real end-to-end fixture run on 2026-05-25. Five detection-layer bugs sit inside already-"done" steps (07b semgrep adapter, 06b OSV adapter, 05b gitleaks adapter, 09b supabase-rls predicate, 14b evidence-report) and weaken the deterministic baseline below its contract. All five make the scan *run* but produce findings that don't reflect what the seeded fixture actually contains.
**Amends Phase 1 step:** none (no contract changes; each fix lives inside an existing agent/scanner adapter)
**Produces:** code fixes only, no new artifacts or types; expanded assertions in `src/cli/end-to-end-fixture.test.ts` to lock the gaps closed
**Depends on:** 21 (plumbing bugs that were hiding these), 22 (the end-to-end gate that exposed them)
**Executed by:** plain coding pass + `step-reviewer` subagent at the end + an end-to-end re-run via `src/cli/end-to-end-fixture.test.ts` as the verification command
**Verification:** `pnpm test --run src/cli/end-to-end-fixture.test.ts` (or the direct CLI roundtrip if `pnpm test` is still blocked by the Node version) — the test asserts each gap in §"Done when" closes, and the existing four-bug regression suite from step 22 stays green.

## Goal

Step 21 fixed the four plumbing bugs that made the scan emit an empty report. Step 22 wrapped those fixes in an end-to-end gate. The first real run through that gate showed the scan *works* but the deterministic baseline is weaker than the report claims: the marquee Lovable+Supabase footgun (a service-role key in the `VITE_*` env namespace) isn't flagged; the secret scanner scans the wrong directory; two of three scanner adapters produce zero facts; and the readiness summary's `evidence_present` count is suspect. This step closes those five gaps so the next run actually matches what the fixture's `expected-findings.json` describes.

This is not a design change. No artifact shape moves, no control contract changes. The fixes are localised to: the supabase-rls predicate's reading of env declarations, the gitleaks adapter's working directory, the semgrep + OSV adapters' configuration flow, and the evidence-report composer's `evidence_present` accounting.

## What lands

Five independent code fixes in one step plus expanded end-to-end assertions.

### Bug A — cc-11-7 silently misses `VITE_SUPABASE_SERVICE_ROLE_KEY` in the fixture's env declarations

**Observed:** the rendered report's "Observed evidence" section lists `env_declarations: VITE_SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL`. That's the canonical "privileged key shipped to the client via Vite env" footgun. cc-11-7's entire contract is to catch this. Yet `cc-11-7` shows `needs_review` with **0 findings** in `readiness-report.json`.

This is the marquee Lovable+Supabase pattern. Every Lovable user who's ever pasted their service-role key into a `.env` file will hit this. Veyra failing to flag it kills the product's headline credibility.

**Where to fix:** likely in `src/agents/supabase-rls/` — find the predicate (or rule) that covers cc-11-7. Audit how it reads `inventory-bootstrap.json` for env-name evidence; confirm it has a match for the `VITE_*` (and `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` etc.) "exposed-to-client" namespaces combined with a sensitive-name pattern (`*SERVICE_ROLE*`, `*SECRET*`, `*PRIVATE_KEY*`). If the predicate exists but doesn't read env_declarations, wire it up. If it doesn't exist, add it inside the existing predicate file — no new control.

**Done when:** a fresh fixture run reports cc-11-7 as `launch_blocker` (per its evidence_strength rules — service-role-in-client-env is canonical-name-list + RLS-bypass-capable → high evidence_strength per CLAUDE.md). The finding's `where_found` cites the env file or the inventory line where `VITE_SUPABASE_SERVICE_ROLE_KEY` was declared. `expected-findings.json` already lists cc-11-7 under `must_surface`; that entry now matches reality. Finding language uses only allowed claims ("appears launch-blocking", "needs human review") per CLAUDE.md §Output language.

### Bug B — gitleaks scope leak: scanner runs against the whole repo, not `--project`

**Observed:** with `--project examples/vulnerable-lovable-supabase`, `scan-facts.json` contains a gitleaks fact at `phases/phase-1/REVISION_AI_SHAPE.md:606` — a Veyra-internal dev doc *outside* the scanned project. The gitleaks adapter is invoking gitleaks with cwd or scan-path set to the repo root rather than the `--project` path.

This is a real privacy + correctness bug for the customer story. A customer running `veyra scan --project ./my-app` from their home directory would scan `~/.aws/credentials`, `~/.ssh/`, neighbouring projects' `.env` files — and those leaks would land in the customer's report.

**Where to fix:** `src/scanners/gitleaks/`. Find the shell-out site (where `spawn`/`execFile`/`exec` invokes `gitleaks`) and confirm:
1. The scan target argument resolves to `context.projectRoot` (or whatever the tool-runner's project-root field is named), not `process.cwd()`.
2. The cwd handed to the child process is also `context.projectRoot`, not inherited.
3. If gitleaks defaults to its cwd when no path is given, an explicit path argument must be passed.

**Done when:** the fixture run's `scan-facts.json` contains zero gitleaks facts with `file_path` outside `examples/vulnerable-lovable-supabase/`. The end-to-end test in `src/cli/end-to-end-fixture.test.ts` gets a new assertion: every gitleaks fact's `file_path` starts with the project-root prefix. Per CLAUDE.md §Secrets: gitleaks invocation must still pass `--redact`; this fix must not weaken that.

### Bug C — Semgrep adapter runs but emits zero facts (rules path not flowing through)

**Observed:** `scan-facts.json` has 2 gitleaks facts and 0 from semgrep. Semgrep is installed (`/opt/homebrew/bin/semgrep`), the adapter runs without raising, but no findings reach the predicates. cc-11-1 / cc-11-3 / cc-11-11 (the controls that depend on semgrep AST patterns) still produce findings today, but only via fallback predicates over inventory — the semgrep AST signal is offline.

The likely root cause: either the `--rules` path defaults to a directory that doesn't exist in this project, or the rules-discovery code doesn't auto-resolve to the repo's top-level `rules/` directory when `--rules` is omitted from the CLI.

**Where to fix:** `src/scanners/semgrep/`. Audit:
1. How the rules directory is resolved when `--rules` isn't passed on argv (default should be the repo's `rules/` dir, or a fixture-bundled rules dir for tests).
2. Whether semgrep is being invoked with a `--config` / `--rules` argument that actually points at YAML rule files.
3. Whether semgrep's stdout/JSON output is being parsed into `ScanFact[]` (a parsing bug here would look identical to "no facts" from the outside — check both).

**Done when:** the fixture run's `scan-facts.json` contains ≥ 1 fact with `source.scanner_id === 'semgrep'`. cc-11-1 / cc-11-3 / cc-11-11 findings now cite semgrep `fact_id`s in addition to (or instead of) inventory-only facts. The end-to-end test gets a new assertion: `scan_facts.some(f => f.source.scanner_id === 'semgrep')`. The fixture has seeded code patterns the rules in `rules/` target — verify by spot-checking one rule's match against the fixture's `src/`.

### Bug D — OSV adapter runs but emits zero facts (lockfile not located)

**Observed:** `scan-facts.json` has 0 facts from `osv-scanner`. osv-scanner is installed. cc-11-10 (vulnerable deps) shows 1 finding today but it's from the heuristic dep-list predicate, not from an OSV CVE match.

The likely root cause: the OSV adapter's lockfile detection isn't finding the fixture's lockfile, or the fixture doesn't have one. Check whether `examples/vulnerable-lovable-supabase/` has `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` at the root; if it does, the adapter isn't finding it; if it doesn't, the fixture itself needs a lockfile to exercise this path.

**Where to fix:** `src/scanners/osv/`. Audit:
1. Lockfile-discovery: which filenames does it look for, in what order, at which depths?
2. osv-scanner invocation: is `--lockfile <path>` being passed, or is OSV being asked to scan a directory?
3. JSON output parsing — similar concern to Bug C: a parser-shape mismatch looks identical to "no facts" externally.

**Done when:** the fixture run's `scan-facts.json` contains ≥ 1 fact with `source.scanner_id === 'osv-scanner'` (assuming the fixture has at least one vulnerable dep — `expected-findings.json` already expects this). cc-11-10 finding's `where_found` cites the OSV `fact_id`, not the heuristic dep-list. The end-to-end test asserts `scan_facts.some(f => f.source.scanner_id === 'osv-scanner')`. If the fixture lacks a lockfile, this step adds the lockfile that pins the package versions called out in the fixture's expected vuln set — that's a fixture-side fix, not a scope creep.

### Bug E — `evidence_present` count is always 0 in the readiness summary

**Observed:** `readiness-report.json.readiness_summary` for the fixture shows `{evidence_present: 0, needs_review: 10, launch_blocker: 2}` for 12 controls. The product's design (per CLAUDE.md §Output language, §10 finding model) distinguishes "positive evidence found" from "needs human review." Right now no control ever reaches `evidence_present`, even when a predicate emits a fact like "this route HAS a server-side auth check." Either the predicates never emit `evidence_present`-classed findings, or the evidence-report composer never promotes a control to `evidence_present`.

**Where to fix:** `src/agents/evidence-report/`. First confirm whether the design intends `evidence_present` to be reachable in the deterministic baseline at all — if it's by-design-Phase-2 (active-validation-only), this isn't a bug, just a docstring or report-key cleanup. If `evidence_present` IS supposed to be reachable in Phase 1, audit:
1. Whether any predicate emits a finding tagged as positive evidence.
2. Whether the composer's per-control roll-up has a path that lands at `evidence_present`.
3. The control card's `readiness_status` derivation logic.

**Done when:** either (a) at least one control in the fixture run lands at `evidence_present` because a predicate found positive evidence and the composer promoted it, OR (b) the design decision is recorded explicitly — `evidence_present` becomes a Phase 2 outcome (active validation produces it), and the summary key is renamed / documented so it doesn't read as "deterministic also produces this." Document whichever path is taken in the step file itself before marking done.

## Done when

All five gaps close on a single fresh fixture run:

1. **Bug A:** `cc-11-7` is `launch_blocker` with at least one finding citing `VITE_*SERVICE_ROLE*` in env_declarations.
2. **Bug B:** every gitleaks fact has `file_path` inside `examples/vulnerable-lovable-supabase/`.
3. **Bug C:** at least one `scan_facts` entry has `source.scanner_id === 'semgrep'`.
4. **Bug D:** at least one `scan_facts` entry has `source.scanner_id === 'osv-scanner'`.
5. **Bug E:** either a control lands at `evidence_present`, OR the step file records that `evidence_present` is Phase-2-only and renames/documents the summary key accordingly.
6. **Regression suite stays green:** the four bug regressions from step 22 still pass — Bugs 1/2/3/4 don't reopen.
7. **`expected-findings.json` cross-check:** every entry in `must_surface` is matched by at least one finding in `readiness-report.json.control_cards[].findings`. Entries in `must_be_coverage_gap` show coverage_gap. No entries in `must_not_surface` appear.
8. **Verification command runs green** when Node is bumped to ≥22.4 and `pnpm test --run src/cli/end-to-end-fixture.test.ts` boots.

## Failure modes and what they mean

- **Bug A's predicate fires on the fixture but not on a real Lovable project.** The matcher is too narrow (only matches the exact fixture string). Generalize to `VITE_*` / `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` + sensitive-name patterns.
- **Bug B fix scopes gitleaks too narrowly.** If `--project` is `.` (the customer's cwd happens to be a project root), the fix must still work. Test with `--project .`.
- **Bug C lands but semgrep emits unrelated facts.** That means rules-discovery picked up rules from outside the project (similar to Bug B). Restrict semgrep's input path the same way.
- **Bug D fix relies on a lockfile being present.** If a user scans a project without one, cc-11-10 should emit `coverage_gap`, not silently miss. Make sure the missing-lockfile case is handled.
- **Bug E forces `evidence_present` paths that don't exist.** Don't fabricate positive evidence — if the deterministic baseline genuinely can't produce it, the right answer is the documentation/rename, not synthetic positives.

## Guardrails

- Do NOT add new controls or new finding kinds. This step fixes detection inside existing controls.
- Do NOT promote any heuristic finding to `confirmed_issue` for cc-11-7's fix — the `VITE_*SERVICE_ROLE*` match is canonical-name-list + RLS-bypass-capable, which per CLAUDE.md / FPP §11 may be `confirmed_issue`; non-canonical name matches stay `likely_issue`.
- Do NOT change the gitleaks invocation in a way that drops `--redact`. CLAUDE.md §Secrets is non-negotiable: raw secrets never reach artifacts, logs, AI prompts, or reports.
- Do NOT widen semgrep's rule-set beyond what's already in `rules/`. This step fixes the wiring; new rules are out of scope.
- Do NOT add a new scanner. Bugs C and D are configuration / lockfile fixes, not new scanners.
- Per CLAUDE.md §Extensibility-first: no new `if (scanner === 'gitleaks')` style branches in shared code. All fixes live inside the scanner adapter's own folder.
- Per CLAUDE.md §Output language: every new string ("not installed", "needs human review", "appears launch-blocking") goes through `output-language-lint` before commit.

## References

- The empty-semgrep / empty-osv evidence from the 2026-05-25 validation run: `examples/vulnerable-lovable-supabase/.veyra/scans/<latest>/scan-facts.json` — 2 facts total, both gitleaks.
- The off-scope gitleaks finding: same `scan-facts.json`, fact with `file_path: phases/phase-1/REVISION_AI_SHAPE.md`.
- The cc-11-7 silent case: same scan's `readiness-report.json` — `control_cards.find(c => c.control_id === 'cc-11-7')` has `findings: []`.
- `examples/vulnerable-lovable-supabase/expected-findings.json` — `must_surface` / `must_be_coverage_gap` / `must_not_surface` lists are the contract this step satisfies.
- `phases/phase-1/steps/05b-scanner-gitleaks-emits-scanfacts.md` (Bug B), `phases/phase-1/steps/06b-scanner-osv-emits-scanfacts.md` (Bug D), `phases/phase-1/steps/07b-scanner-semgrep-emits-scanfacts.md` (Bug C) — the scanner adapter contracts this step doesn't change.
- `phases/phase-1/steps/09b-supabase-rls-as-assertion-predicate.md` (Bug A) — the predicate contract.
- `phases/phase-1/steps/14b-evidence-report-with-new-artifacts.md` (Bug E) — the composer contract.
- `phases/phase-1/steps/22-19b-gate-end-to-end-rewire.md` — the gate that exposed all five gaps and where the new assertions land.
- `src/cli/end-to-end-fixture.test.ts` — the test file that gets new assertions for Bugs A–D and (if applicable) E.
- `CLAUDE.md §Output language`, `§Secrets`, `§Extensibility-first architecture` — non-negotiable rules every fix must honor.
