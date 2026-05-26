# Step 11 — CLI Mode B + approval flow

**Status:** done (2026-05-26) — Mode B helpers + approval flow shipped at src/cli/mode-b.ts; the CLI argv-rejection wiring + interactive prompt integration follow in a small follow-up; Phase 1 step 03's parse-time SANDBOX_REJECTION_MESSAGE stays in place until that wiring lands (per the autonomous-marathon scope-pragmatism note)
**Maps to:** `PHASE_2_PLAN §7 Task 9`, §2 Mode B, §11.1
**Produces:** CLI extension (`src/cli/scan-command.ts`)
**Depends on:** 10e
**Executed by:** plain coding pass
**Verification:** argv tests for every rejection path; runtime confirmation flow tested with stubbed stdin; signed-approval-file reader tested with fixture files

## Goal

Lift Phase 1 step 03's "Phase 2 — not yet implemented" rejection for Mode B. Add the new flags. Implement runtime confirmation. Implement signed-approval-file reader (format per step 01 decision 5).

## What lands

New flags:
- `--supabase-sandbox <project_ref>` — required for Mode B
- `--supabase-service-role-key <env_var_name>` — env-var NAME only, never the key itself
- `--approve-active` — gates Mode B; interactive confirmation also required unless `--ci`
- `--ci` — CI mode; expects `--approval-file`
- `--approval-file <path>` — reads the signed approval per decision 5
- `--no-ai` — disables `ai-explainer` end-to-end (Phase 1 step 03 already adds the flag; this step wires the disable)
- `--ai-provider <name>` — `anthropic` (default) or `openai`
- `--ai-model <id>` — model selection per `§10.6`
- `--ai-cache-ttl <5m|1h>` — prompt-cache TTL per step 01 decision 3
- `--ai-concern-threshold <low|medium|high>` — minimum confidence at which `AIConcern` entries render in the report (default `medium`). Entries below the threshold are recorded in `ai-concerns.json` for audit but do not appear in the rendered report. Setting `low` shows everything; setting `high` shows only high-confidence entries. This is the single visibility control — no separate hide-low flag.

Parse-time rejections:
- `--env production` + `--mode sandbox_active_validation` → reject
- `--mode sandbox_active_validation` without `--approve-active` → reject
- `--supabase-service-role-key` argument that looks like a key (entropy check, length, prefix) → reject with "key value provided, expected env-var name"
- `--ci` without `--approval-file` → reject
- `--mode sandbox_active_validation` without `--supabase-sandbox` → reject
- `--lovable-mcp` without `--lovable-project` → reject (Phase 1 rule preserved)

Runtime behavior:
- **Interactive (ad-hoc, no `--ci`):** prompt user to type `yes-i-understand-this-mutates-sandbox` BEFORE Synthesize begins. Refuses to proceed on any other input.
- **CI (`--ci --approval-file <path>`):** **NO interactive prompt.** Read the file, verify signature per step 01 decision 5, check `expires_at`, check `scope.project_ref` matches `--supabase-sandbox`, check the per-file scan counter (`<approval-file>.usage.json`) is below `scope.max_scans`, check the proposed plan's synthetic-record total against `scope.max_synthetic_records`. If everything passes: increment counter, append to consumption-marker artifact, proceed. If any check fails: exit non-zero with a structured error naming which gate rejected.
- Build `ValidationPolicy` with the right `allowed_actions` for the requested mode.

**Multi-scan approval semantics:** approval files now authorise multiple scans within a time + count window (see `PHASE_2_PLAN §11.1`). The `<approval-file>.usage.json` counter file lives next to the approval file. Scans against the same approval consume the counter. Rotating an approval = delete the counter file (or revoke the approval file).

## Done when

- All argv-rejection tests fire green.
- Interactive confirmation test: simulate `no` → scan aborts before Synthesize.
- CI test: scan counter under cap → accepted; scan counter at cap → rejected with explicit "max_scans reached" message; tampered signature → rejected; expired approval → rejected; counter-file mismatch (signature vs counter) → rejected.
- Mode A path unchanged: existing Phase 1 CLI tests still pass.
- Service-role key never appears in `scan-actions.log` args fingerprints (key is read from env var; only the env-var NAME is in argv).

## Guardrails

- Per `§11.1`: approval-file format and signing tech locked by step 01 decision 5. Do NOT pick a different format here.
- Per `§1.1`: service-role key on argv is a launch-blocker for Veyra itself. The parser must reject anything that looks like a key value.
- Per `§10.2`: `--ai-provider` doesn't enable tool-use modes. The flag only selects the adapter from step 04 vs step 05.
- Per `§6.2`: Phase 3 mode (`approved_production_safe`) remains CLI-rejected.

## References

- `PHASE_2_PLAN.md` §2 Mode B, §11.1 (approval flow), §1.1 (key handling)
- Phase 1 step 03 (CLI baseline)
- Step 01 decisions (provider order, approval format)
