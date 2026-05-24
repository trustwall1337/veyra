# Step 13 — Fixture extension: sandbox + `expected-outcomes.json`

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 11`, §8 success criteria
**Produces:** fixture (`examples/vulnerable-lovable-supabase/sandbox-fixture/`)
**Depends on:** 10e
**Executed by:** plain coding pass
**Verification:** `expected-outcomes.json` keyed by `control_id` matches `controls.ts` (consistency test); fixture README documents whether live or recorded (per step 01 decision 4)

## Goal

Extend the Phase 1 vulnerable fixture so Mode B can run end-to-end against it. Form determined by step 01 decision 4 (live disposable Supabase project vs recorded-fixture replay).

## What lands

### Common (both options)

- `examples/vulnerable-lovable-supabase/sandbox-fixture/` directory.
- `examples/vulnerable-lovable-supabase/sandbox-fixture/expected-outcomes.json` keyed by `control_id`:
  - `cc-11-2` → `proven_allowed` (admin route without server check)
  - `cc-11-3` → `proven_allowed` (direct object access)
  - `cc-11-4` → `proven_allowed` (client tenant_id override)
  - `cc-11-5` → `proven_denial` on RLS-on variant; `proven_allowed` on RLS-off variant (two fixtures or a parameterized one)
  - `cc-11-6` → `proven_allowed` (broad `USING (true)`)
  - `cc-11-12` → `proven_allowed` (public bucket)
  - Seeded clean controls → `proven_denial` or no `TestPlanEntry` emitted

### Live-fixture option (step 01 decision 4 = live)

- `examples/vulnerable-lovable-supabase/sandbox-fixture/setup.md` — documented disposable-project setup: create a fresh Supabase project, apply the seeded schema + seed data, generate a service-role key, set env vars. CI bot owns this project.
- The fixture README warns: "this project is intentionally broken. Do not put real data here. Run only against the dedicated test project listed in this README."

### Recorded-fixture option (step 01 decision 4 = recorded)

- `examples/vulnerable-lovable-supabase/sandbox-fixture/recordings/` — HTTP and Supabase Admin API recordings (one file per test in step 07).
- A recorder script (not part of the scan path) that re-records when the Admin API surface changes.
- The fixture README documents: "these recordings freeze the Admin API contract at <date>. If a Supabase SDK update breaks them, re-record."

## Done when

- `expected-outcomes.json` exists and references only `control_id`s from `controls.ts` (consistency test fails the build on drift).
- Fixture README documents the chosen option clearly.
- Step 15 gate can read `expected-outcomes.json` and assert outcome-per-control against scan output.

## Guardrails

- The fixture's sandbox-project — if live — must NEVER hold real customer data. Periodic cleanup is mandatory.
- No real third-party credentials checked in. Service-role keys live in env vars only.
- The fixture's expected outcomes describe what the scan SHOULD see; do not relax them to make findings "pass." If outcomes drift, fix the agent or the fixture in the same commit.
- Recorded fixtures must not contain real PII from external Supabase projects — they are recorded only against the documented test project.

## References

- `PHASE_2_PLAN.md` §8 (Success criteria)
- Step 01 decision 4 (fixture form)
- Phase 1 step 04 (base fixture — reused unchanged)
- Step 14 `controls.ts` (canonical `control_id` source)
