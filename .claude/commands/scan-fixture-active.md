---
description: Run Veyra's Phase 2 active-validation fixture gate against the recorded sandbox fixture
---

# /scan-fixture-active

Per step 2.01 decision 6: **new command**, distinct from `/scan-fixture`
(the Phase 1 deterministic gate). Cleaner failure isolation; the
Phase 1 gate stays frozen as a regression bar.

## What it does

Runs the Phase 2 active-validation pipeline (Synthesize → Exercise →
Cleanup → Prove) against the recorded sandbox fixture under
`examples/vulnerable-lovable-supabase/sandbox-fixture/` and asserts
every `(control_id, variant_id)` tuple in `expected-outcomes.json`
produces the expected outcome.

Per step 2.01 decision 8 (Phase-1 mistake preventer): this command
pairs with a representative dev/sandbox project gate. The seeded
recorded fixture is the always-runs CI gate; the live opt-in (when
the user has Pro/Business Supabase credentials available) refreshes
the recordings.

## Invocation

```bash
# CI / default — recorded-fixture replay (deterministic, no network)
pnpm dev -- scan-fixture-active

# Live opt-in (per step 2.01 decision 4 fallback)
VEYRA_LIVE_TESTS=1 SUPABASE_SERVICE_ROLE_KEY_NAME=VEYRA_TEST_SRK \
  pnpm dev -- scan-fixture-active --record
```

## What it asserts (step 2.15 §"Done when")

Every assertion in `PHASE_2_PLAN §8` fires green:

- The active-validation pipeline produces a non-empty
  `active-validation-results.json` against the fixture.
- Every `(control_id, variant_id)` in `expected-outcomes.json` matches
  the observed outcome in `active-validation-results.json`.
- `cleanup-proof.json` shows `residual_count: 0` (the recorder
  cleans up after itself).
- `scan-actions.log` shows every state-changing action with a
  SHA-256 fingerprint and no raw secret values.
- The seeded "broken" fixture produces real findings (proven_allowed
  outcomes promote upstream Phase 1 findings to `confirmed_issue`
  per step 2.10e's promotion rule).
- The deterministic-fallback plan produces identical compiled
  output as the AI-planner plan (producer-agnostic compiler check).

## What it does NOT do

- Does not call out to a live Supabase project unless
  `--record` + `VEYRA_LIVE_TESTS=1` + `SUPABASE_SERVICE_ROLE_KEY_NAME`
  env var are all set.
- Does not commit anything — running the gate is a verification
  step; the diff (if any) is the recorder script's output.
- Does not promote any finding above `confirmed_issue`. Promotion
  ceiling is owned by `evidence-report` (step 2.10e).

## Status

Step 2.15 ships this command's command-file (this file) + the
gate-runner harness lives at
`src/cli/fixture-active-gate.ts` (the test that runs the gate
against the recorded fixture). The CLI flag wiring into a real
`pnpm dev -- scan-fixture-active` invocation is small follow-up
work (it shares 80%+ of its shape with the Phase 1 `/scan-fixture`
gate command and runs at the same release-cadence cadence).
