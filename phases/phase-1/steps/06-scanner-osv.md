# Step 06 — OSV-Scanner adapter

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 9`, §1 OSV-Scanner verified capabilities
**Produces:** `src/scanners/osv/`
**Depends on:** 02
**Executed by:** `/new-scanner-adapter` skill
**Verification:** Vitest fixture-JSON tests

## Goal

Wrap OSV-Scanner behind a minimal adapter that scans the fixture's lockfile for known vulnerable dependencies. Picked over `npm audit` because OSV covers more ecosystems and normalizes advisories — Phase 4 roadmap (`FINAL_PRODUCT_PLAN §17`) anticipates broader stacks beyond npm.

## What lands

- `src/scanners/osv/adapter.ts` — `spawn()`-based invocation with array args, explicit timeout. Default args include `--format json --lockfile <path>`.
- `src/scanners/osv/parser.ts` — JSON-only output parsing into normalized `ScannerFinding[]`.
- `src/scanners/osv/types.ts` — adapter input/output types.
- `src/scanners/osv/index.ts` — re-exports.
- Fixtures under `src/scanners/osv/__fixtures__/` for: happy path with findings, no findings, malformed JSON, binary missing.
- `*.test.ts` files alongside.

## Done when

- `/new-scanner-adapter` skill checklist all green.
- Fixture-JSON tests cover: empty result, populated result, malformed JSON, binary missing.
- Findings are tagged with `evidence_strength: medium` by default and `review_action: review_before_launch` — dependency findings are launch-readiness signals, not proof of exploitability (per §1 OSV conclusion).
- Adapter accepts a lockfile path; refuses to traverse the project file system on its own.

## Guardrails

- Dependency findings must NOT be emitted as `confirmed_issue`. They are `likely_issue` or `informational` per Phase 1 trust model — silence ≠ safe, presence ≠ exploitable.
- No network calls from the adapter itself. OSV-Scanner does its own offline DB sync; Veyra invokes it locally.
- Subprocess uses `spawn` with array args, never a shell string.

## References

- `PHASE_1_PLAN.md` §1 (OSV-Scanner verified), §3 Step 3, §7 Task 9
- `FINAL_PRODUCT_PLAN.md` §17 (Phase 4 ecosystem broadening rationale)
- `.claude/skills/new-scanner-adapter/SKILL.md`
