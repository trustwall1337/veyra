# Synthetic data and cleanup

Phase 2 sub-mode B.2 (auto-synthesize) creates synthetic users +
tenants + records in the customer's sandbox to drive negative
tests, then deletes everything before exiting. This page documents
the cleanup contract and the bounded-retry semantics that protect
the customer's sandbox from residual data.

## The synthetic-data manager (step 2.06)

One agent owns the full lifecycle: synthesize + cleanup. Two methods:

- `synthesize(plan, policy)` — walks the compiled scan plan, calls
  `auth.admin.createUser(...)` per identity, tags every row with
  `user_metadata.veyra_scan_id` + `user_metadata.veyra_synthetic`,
  records the returned UUID in a Veyra-owned in-memory registry,
  and persists the registry to `synthetic-resources.json` BEFORE
  any test runs.
- `cleanup(scan_id)` — reads the registry; for each registered
  UUID, calls `auth.admin.deleteUser(uuid, false)` (hard delete);
  verifies via per-UUID `auth.admin.getUserById(uuid)` returning
  HTTP 404.

## Cleanup contract (PHASE_2_PLAN §11.3)

- **Hard delete only.** Soft delete would leave rows that look
  like residuals.
- **Bookkeeping-driven verification.** Veyra never calls
  `auth.admin.listUsers` in the scan path. That would enumerate the
  user table — a customer-trust violation. The agent's registry is
  authoritative; only the specific UUIDs Veyra created are queried.
- **Orphan probe at construction.** ONE bounded `listUsers` call at
  agent construction, scoped to the Veyra namespace prefix
  (`veyra-synth-`). If any pre-existing matching rows exist, the
  agent refuses to operate until manual cleanup. The orphan probe
  is the only allowed broad-query path.
- **Bounded auto-retry on residuals.** If verification finds
  `residual_count > 0`, the manager retries `deleteUser(uuid)` for
  each residual UUID up to 3 times with exponential backoff (1s,
  4s, 16s). Every retry attempt logs to `scan-actions.log` as
  `{ action_id: 'cleanup_retry', attempt: 1..3, uuid_fingerprint_sha256, outcome }`.
  If residuals clear within the budget, the scan continues.
- **Hard fail on retry exhaustion.** If `residual_count > 0` AFTER
  the 3 retries, Veyra emits a `confirmed_issue + fix_before_launch`
  finding on `cc-2-06` and exits non-zero. The customer must
  manually clean before another scan can proceed.

## Cleanup proof shape

`cleanup-proof.json`:

```json
{
  "scan_id": "veyra-2026-05-26T...-abc1",
  "created_count": 3,
  "deleted_count": 3,
  "residual_count": 0,
  "duration_ms": 4528,
  "per_resource_log": [
    { "uid": "synth-uid-0", "outcome": "deleted", "retries": 0 },
    { "uid": "synth-uid-1", "outcome": "deleted", "retries": 1 },
    { "uid": "synth-uid-2", "outcome": "deleted", "retries": 0 }
  ]
}
```

The reporter (step 2.12) flags `residual_count > 0` as "appears
launch-blocking" + "needs human review."

## Failure paths

- **Synthesize fails mid-stream.** Roll back every resource created
  so far. Scan aborts before Exercise. Exit non-zero.
- **Exercise crashes.** Try-finally invokes Cleanup (step 2.14
  orchestrator). `active-validation-results.json` is partial. Exit
  non-zero.
- **Cleanup retries exhaust.** As above: confirmed_issue +
  fix_before_launch + non-zero exit.

## What this is not

- Not a "delete harder" loop. Three retries is the floor + ceiling.
  "Delete harder" is the failure mode of a malicious tool.
- Not a cron / scheduled cleanup. Cleanup runs ONCE, in-scan.
- Not a backup / restore path. If a customer's sandbox has live
  data Veyra cannot prove is synthetic, the orphan probe refuses
  at construction.
