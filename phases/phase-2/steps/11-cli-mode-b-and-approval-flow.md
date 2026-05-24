# Step 11 — CLI Mode B + approval flow

**Status:** not started
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

Parse-time rejections:
- `--env production` + `--mode sandbox_active_validation` → reject
- `--mode sandbox_active_validation` without `--approve-active` → reject
- `--supabase-service-role-key` argument that looks like a key (entropy check, length, prefix) → reject with "key value provided, expected env-var name"
- `--ci` without `--approval-file` → reject
- `--mode sandbox_active_validation` without `--supabase-sandbox` → reject
- `--lovable-mcp` without `--lovable-project` → reject (Phase 1 rule preserved)

Runtime behavior:
- Interactive: prompt user to type `yes-i-understand-this-mutates-sandbox` BEFORE Synthesize begins. Refuses to proceed on any other input.
- CI: read `--approval-file`; verify signature per step 01 decision 5; check that `scan_id_prefix` matches this scan; check `expires_at`; write a consumption-marker artifact; refuse reuse on a second scan.
- Build `ValidationPolicy` with the right `allowed_actions` for the requested mode.

## Done when

- All argv-rejection tests fire green.
- Interactive confirmation test: simulate `no` → scan aborts before Synthesize.
- CI test: reuse approval file → second scan rejected; tampered signature → rejected; expired approval → rejected.
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
