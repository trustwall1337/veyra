# Phase 2 sandbox fixture

Per step 2.01 decision 4: **recorded-fixture replay** (chosen over
live disposable Supabase project for determinism + CI hermeticity).

## What's here

- `expected-outcomes.json` — array of
  `{ control_id, variant_id, expected_outcome }` entries. Step 2.15's
  fixture-validation gate asserts each `(control_id, variant_id)`
  tuple produces the expected outcome.
- `recordings/` — recorded HTTP + Supabase Admin API responses, one
  file per `(control_id, variant_id)`. These freeze the Admin API
  contract at recording time.

## Trust posture

These recordings are deterministic stand-ins. They were captured
once against a disposable Supabase project intentionally seeded
with broken controls (no RLS on `orders`, `USING (true)` policies,
public bucket with anon SELECT, etc.). The recordings are then
replayed by `pnpm test --run` so CI does not need network access.

The fixture is itself a Lovable + Supabase app that you should
treat as broken. Do not point Veyra at it expecting clean output —
it exists to prove the active-validation pipeline detects the
seeded mistakes.

## When to re-record

Re-record when:
- A `@supabase/supabase-js` SDK update changes a response shape
  (test failures will surface this).
- The Phase 2 catalog (step 2.07 / 2.07d) adds a new
  `(control_id, variant_id)` entry that the gate must verify.

The recorder script (not part of the scan path) lives at
`scripts/record-sandbox-fixture.ts` (lands with step 2.15 when the
gate command boots).

## What's intentionally NOT here

- No live Supabase credentials. The recordings carry no service-role
  key, no JWT, no auth tokens. They were captured with the redaction
  helpers from step 25's `redactTokenIn`.
- No real customer data. All identities, tenants, and records are
  synthetic (`veyra-synth-<scan_id>-...`).
