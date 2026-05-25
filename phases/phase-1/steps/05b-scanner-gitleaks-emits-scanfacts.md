# Step 05b — Gitleaks adapter emits `ScanFact[]` (no Findings)

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §3.1, §9 step 05 row`
**Amends Phase 1 step:** 05
**Produces:** amended adapter at `src/scanners/gitleaks/`
**Depends on:** 02b
**Executed by:** `/new-scanner-adapter` skill (amendment mode)
**Verification:** existing 05 fixture tests replayed against new shape; redaction unchanged; `ScanFact.source.kind === 'scanner_match'` and `scanner_id` resolves via registry

## Goal

Gitleaks adapter stops producing `Finding` records. It now emits `ScanFact[]` with `source.kind = 'scanner_match'` and an opaque `scanner_id`. Finding construction moves out of `src/scanners/` entirely — into the assertion-layer predicates (step 09b–12b).

## What lands

- `src/scanners/gitleaks/adapter.ts` — return type changes from `Finding[]` to `ScanFact[]`.
- Each ScanFact: `{ source: { kind: 'scanner_match', scanner_id: <registered id for gitleaks>, payload: { sanitized_excerpt: '<redacted line context>', content_kind: 'redacted_secret_context', byte_range } }, file_path, line, observed_at, args_fingerprint_sha256, redacted: true }`.
- Gitleaks `--redact` continues to be mandatory. The `sanitized_excerpt` is already-redacted content; the raw match never enters the payload.
- Existing 05 fixtures replayed: same input files → ScanFact equivalents of the Findings the original step 05 emitted.

## Done when

- `src/scanners/gitleaks/` no longer constructs any `Finding` object. Verified by grep + type checker.
- All 05 fixture tests pass against the new shape.
- `--redact` flag still in default args (existing 05 test still passes).
- `ScannerNotInstalledError` path unchanged.
- Sanitization-before-store: any secret pattern that survives redaction is caught by 02c's sanitization helpers before the ScanFact persists.

## Guardrails

- Per `CLAUDE.md §Secrets`: `--redact` is non-negotiable. Removing it is a launch-blocker for Veyra itself.
- Raw secret values never enter the payload. Adapter tests verify this with a fake Gitleaks JSON containing a known secret pattern — assert it does not appear anywhere in the resulting ScanFact.
- Per `FPP §2A`: `scanner_id` is opaque. No `'gitleaks'` string union in shared types.
- The cc-11-8 predicate (lands in step 09b–12b's reshape) is the only thing that converts these facts into a `Finding`.

## References

- `REVISION_AI_SHAPE.md` §3.1
- `phase-1/steps/05-scanner-gitleaks.md` (original — `Status: done`, rolls back to `not started`)
- `CLAUDE.md` §Secrets
