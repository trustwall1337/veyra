# Step 06b — OSV-Scanner adapter emits `ScanFact[]`

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §3.1, §9 step 06 row`
**Amends Phase 1 step:** 06
**Produces:** amended adapter at `src/scanners/osv/`
**Depends on:** 02b
**Executed by:** `/new-scanner-adapter` skill (amendment mode)
**Verification:** existing 06 fixture tests replayed against new shape

## Goal

OSV-Scanner adapter stops producing `Finding` records. It emits `ScanFact[]` with `source.kind = 'scanner_match'` and an opaque `scanner_id`. The cc-11-10 predicate (vulnerable dependency) is the only thing that converts these facts into a `Finding`.

## What lands

- `src/scanners/osv/adapter.ts` — return type changes from `Finding[]` to `ScanFact[]`.
- Each ScanFact: `{ source: { kind: 'scanner_match', scanner_id: <registered id for osv>, payload: { sanitized_excerpt: '<advisory id + package + version>', content_kind: 'text' } }, file_path: '<lockfile path>', observed_at, args_fingerprint_sha256, redacted: false }`.
- Existing 06 fixtures replayed.

## Done when

- `src/scanners/osv/` no longer constructs any `Finding`. Verified by grep + type checker.
- All 06 fixture tests pass against the new shape.
- `ScannerNotInstalledError` path unchanged.
- cc-11-10-relevant facts (vulnerable packages by name + version + advisory id) surface in the consolidated `scan-facts.json`.

## Guardrails

- Per `FPP §2A`: `scanner_id` is opaque. No `'osv'` string union in shared types.
- Dependency findings remain `likely_issue` at the assertion layer — silence ≠ exploitable, presence ≠ confirmed. Adapter does not classify.
- Adapter does not call OSV's network DB sync at scan time; honours the existing offline-first contract from step 06.

## References

- `REVISION_AI_SHAPE.md` §3.1
- `phase-1/steps/06-scanner-osv.md` (original — `Status: done`, rolls back to `not started`)
