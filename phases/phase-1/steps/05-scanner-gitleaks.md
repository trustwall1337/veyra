# Step 05 — Gitleaks scanner adapter

**Status:** done (2026-05-24)
**Maps to:** `PHASE_1_PLAN §7 Task 9`, §4.6 (Tool-runner controls), `CLAUDE.md §Secrets`
**Produces:** `src/scanners/gitleaks/`
**Depends on:** 02
**Executed by:** `/new-scanner-adapter` skill
**Verification:** Vitest with fixture JSON outputs (no real binary call) + redaction-of-raw-secret unit test

## Goal

Wrap Gitleaks behind a minimal adapter that subprocess-executes the binary, parses JSON output, and never exposes raw secret values. First scanner because secrets-in-repo is `FINAL_PRODUCT_PLAN §11` checks #1, #2, #8.

## What lands

- `src/scanners/gitleaks/adapter.ts` — `spawn()`-based invocation, array args, explicit timeout (per skill template). Default args include `detect --report-format json --redact`.
- `src/scanners/gitleaks/parser.ts` — JSON-only output parsing into normalized `ScannerFinding[]`.
- `src/scanners/gitleaks/types.ts` — adapter input/output types.
- `src/scanners/gitleaks/index.ts` — re-exports.
- Test fixtures under `src/scanners/gitleaks/__fixtures__/` for: happy path with findings, no findings, malformed JSON, binary missing.
- `*.test.ts` files alongside.

## Done when

- `/new-scanner-adapter` skill checklist all green.
- `--redact` is in default args (verified by unit test that asserts the arg array).
- Binary-missing path returns `ScannerNotInstalledError` (typed), not a generic throw.
- Redaction test: feed a fake Gitleaks JSON output containing a raw secret string; assert the adapter's normalized output does NOT contain that string anywhere — `secret`, `match`, `line` content fields are scrubbed.

## Guardrails

- `--redact` is non-negotiable (per `CLAUDE.md §Secrets`). Removing it is a launch-blocker for Veyra itself.
- Never `console.log` adapter input or raw output. Test logs must not contain secret-like values.
- Do not store raw Gitleaks output in the artifact store. Persist only the normalized, scrubbed form.
- `stderr` must be captured and stored alongside stdout for auditability, but check it for secret-like patterns before persisting.
- Subprocess uses `spawn` with array args, never a shell string. No command injection surface.

## References

- `PHASE_1_PLAN.md` §1 (Gitleaks verified capabilities), §3 Step 3, §4.6, §7 Task 9
- `CLAUDE.md` §Secrets, §Hard rules
- `.claude/skills/new-scanner-adapter/SKILL.md`
