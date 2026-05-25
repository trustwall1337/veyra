# Step 07b — Semgrep adapter emits `ScanFact[]`

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §3.1, §9 step 07 row`
**Amends Phase 1 step:** 07
**Produces:** amended adapter at `src/scanners/semgrep/`
**Depends on:** 02b
**Executed by:** `/new-scanner-adapter` skill (amendment mode)
**Verification:** existing 07 rule fixtures replayed against new shape; `rule_id` preserved in payload so multiple predicates can dispatch

## Goal

Semgrep adapter stops producing `Finding` records. Emits `ScanFact[]` with `source.kind = 'scanner_match'` and an opaque `scanner_id`. Multiple predicates downstream (cc-11-1 frontend-only, cc-11-2 admin route, cc-11-3 direct-object-access, cc-11-4 client-tenant_id, cc-11-7 client-side privileged key) dispatch on `rule_id` within the payload.

## What lands

- `src/scanners/semgrep/adapter.ts` — return type changes from `Finding[]` to `ScanFact[]`.
- Each ScanFact: `{ source: { kind: 'scanner_match', scanner_id: <registered id for semgrep>, payload: { sanitized_excerpt: '<captured code snippet, redacted for secret-like patterns>', content_kind: 'text', byte_range, rule_id: '<semgrep rule id>' } }, file_path, line, observed_at, args_fingerprint_sha256, redacted: <true if any redaction applied> }`.
- The `rule_id` field inside the payload is what predicates dispatch on. Predicates do not know which scanner produced the fact; they care about the rule.
- Existing 07 rule fixtures replayed — same input files trigger the same `rule_id`s.

## Done when

- `src/scanners/semgrep/` no longer constructs any `Finding`. Verified by grep + type checker.
- `semgrep --test rules/` still passes (rules unchanged).
- All 07 adapter fixture tests pass against the new shape.
- `rule_id` is reachable from a ScanFact in the consolidated `scan-facts.json`.

## Guardrails

- Per `FPP §2A`: `scanner_id` is opaque. No `'semgrep'` string union in shared types.
- Code-snippet sanitization-before-store: secret-like patterns in captured code are redacted by 02c helpers before the ScanFact persists.
- Rule files under `rules/{authz,supabase,secrets}/` are unchanged by this step.

## References

- `REVISION_AI_SHAPE.md` §3.1
- `phase-1/steps/07-scanner-semgrep-and-rules.md` (original — `Status: done`, rolls back to `not started`)
