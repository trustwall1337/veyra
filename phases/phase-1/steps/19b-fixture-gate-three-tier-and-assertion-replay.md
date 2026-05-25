# Step 19b — Fixture gate: three-tier output + `--no-ai` baseline + assertion-replay determinism

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §12 step 19 row`; revision §14 Q7
**Amends Phase 1 step:** 19
**Produces:** verification only (no new code)
**Depends on:** 18b, 04b
**Executed by:** `/scan-fixture` skill (+ `output-language-lint` subagent + `plan-adherence` subagent)
**Verification:** four assertions in §8 below all fire green; gate fails closed if any regress

## Goal

The Phase 1 revision is done when the fixture validation gate confirms: (a) the three-tier report renders correctly, (b) `--no-ai` produces an identical Findings set to the AI-enabled run, (c) AIConcerns are emitted per the threshold flag and respect `expected-ai-concerns.json`, (d) the assertion layer is deterministic — same `ScanFact[]` + `Hypothesis[]` fed twice produces byte-identical `findings.json` + `ai-concerns.json`.

## What lands

- Nothing new in `src/`. This is a verification pass.
- `/scan-fixture` command extended to run the four gate checks below.
- Snapshot baseline files updated under `examples/vulnerable-lovable-supabase/__snapshots__/` to match the post-revision report shape.

## Done when

All four gates pass:

1. **Three-tier rendering** — the rendered `veyra-report.md` shows three distinct headings: "Findings," "AI-suggested areas for human review" (with confidence threshold respected), "Active validation outcomes" (placeholder in Phase 1; Phase 2 fills it).
2. **`--no-ai` baseline parity** — run the scan twice, once with AI enabled (env var + `--ai-provider`), once with `--no-ai`. Findings sets are identical. AIConcerns are present in the first run, absent in the second. Sources section in the second run shows "AI was disabled for this scan; AIConcerns not produced."
3. **Expected AIConcerns surface** — entries marked `must_surface: true` in `expected-ai-concerns.json` appear in the AI-enabled run. `must_surface: false` entries are tolerated but not required. `confidence: 'low'` entries are tolerated below the default threshold.
4. **Assertion-replay determinism** — capture `scan-facts.json` + `hypotheses.json` from one scan, feed them back through the assertion layer + Pass-2 module, assert byte-identical `findings.json` + `ai-concerns.json` + `assertions.json`. Modulo scan_id and timestamps (which are scrubbed by snapshot serializers).

Additional checks:

- `output-language-lint` returns zero hits on the rendered report.
- `plan-adherence` on the full revision diff confirms no `Not Required` items snuck in.

## Failure modes and what they mean

- **Tier mixing** — an AIConcern appears under the Findings heading. Bug in 13b; do not mask in the gate.
- **`--no-ai` parity break** — Findings set differs between runs. Bug somewhere in the predicates (Pass-1 took a hypothesis as input). Fix the predicate, not the test.
- **Expected concern missing** — `must_surface: true` entry didn't appear. AI Inference Agent (08d) or its prompt regressed. Fix upstream, not the expectation file.
- **Assertion replay diverges** — Pass-2 disposition has hidden state. Find the state, remove it.

## Guardrails

- Do NOT loosen any of the four gate assertions to make the gate pass. The gate is the contract.
- Do NOT introduce `--ai-concern-threshold low` in the test to mask missing concerns — the test runs at default `medium`.
- Do NOT widen the `output-language-lint` allowlist.
- Per revision §14 Q8: deterministic-only runs do NOT produce `missing_evidence` Findings for controls that would have benefited from AI. Gate enforces this.

## References

- `REVISION_AI_SHAPE.md` §12 step 19 row, §14 Q7
- `phase-1/steps/19-fixture-validation-gate.md` (original — was not done; this amendment supersedes it)
- 04b (expectation files), 18b (orchestrator under test)
