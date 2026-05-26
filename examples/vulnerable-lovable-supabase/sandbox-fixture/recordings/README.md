# Sandbox-fixture recordings (codex retro 2.13-recordings-missing)

Per step 2.01 decision 4 (recorded-fixture replay), this directory
holds redacted HTTP + Supabase Admin API recordings — one file per
`(control_id, variant_id)` tuple from `../expected-outcomes.json`.

## Current state

This directory is **intentionally empty** in the shipped tree. The
recordings are captured against a live disposable Supabase project
that intentionally seeds the broken controls (no RLS on `orders`,
`USING (true)` policies, public bucket with anon SELECT, etc.).

## To populate

Run the recorder against the disposable project:

```bash
# Requires Pro/Business Supabase sandbox + service-role key.
export SUPABASE_PROJECT_REF=<your-sandbox-ref>
export VEYRA_TEST_SRK=<service-role-key>
export VEYRA_LIVE_TESTS=1

pnpm dev -- scan-fixture-active --record \
  --supabase-sandbox $SUPABASE_PROJECT_REF \
  --supabase-service-role-key VEYRA_TEST_SRK \
  --record-output ./examples/vulnerable-lovable-supabase/sandbox-fixture/recordings/
```

The recorder writes one JSON file per `(control_id, variant_id)`
named `<control_id>__<variant_id>.json`, e.g.:

- `cc-11-5__rls-off.json`
- `cc-11-5__rls-on.json`
- `cc-11-12__public-bucket.json`

Each recording is the deterministic stand-in step 2.15's gate
replays against. The recorder + CLI plumbing land with the gate-
runner follow-up.

## What recordings carry

- HTTP request method, URL, body (sanitized; never JWTs).
- HTTP response status, headers (Authorization stripped), body
  (JWTs stripped via `redactTokenIn` at capture time).
- Supabase Admin API responses (createUser/deleteUser/getUserById)
  with synthetic UIDs only.

## What recordings NEVER carry

- Live Supabase credentials (service-role key, anon key).
- JWTs of synthetic users (kept in-memory at scan time; never
  written to a recording).
- Customer code, customer rows from real tables.
- Any non-synthetic user identifier.
