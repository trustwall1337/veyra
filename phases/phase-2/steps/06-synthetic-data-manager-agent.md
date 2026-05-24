# Step 06 — `synthetic-data-manager` agent (Synthesize + Cleanup)

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 4`, §3.2, §3.4, §4.8, §11.2, §11.3
**Produces:** agent (`src/agents/synthetic-data-manager/`) + connector (`src/connectors/supabase/admin/`)
**Depends on:** 03
**Executed by:** `/new-agent` skill (+ `/new-connector` for the Admin SDK wrapper)
**Verification:** synthesize-then-cleanup roundtrip with `residual_count: 0`; partial-failure rollback; induced-cleanup-failure asserts non-zero exit + residual report + `confirmed_issue` finding

## Goal

Single failure boundary for both Synthesize and Cleanup. The agent reads `scan-plan.json`, provisions synthetic identities/tenants/records via the Supabase Admin SDK, then reverses every resource on Cleanup. All-or-nothing Synthesize semantics; Cleanup runs even on Exercise crash (via orchestrator try-finally from step 14).

## What lands

### Agent (`src/agents/synthetic-data-manager/`)

- `agent.ts` — implements `VeyraAgent`. Two methods: `synthesize(plan, policy)` and `cleanup(scan_id)`.
- `synthesize` semantics: walk `scan-plan.json` entries; for each resource, call the relevant `ActionExecutor.execute` action; tag every resource with `user_metadata.veyra_scan_id` and `user_metadata.veyra_synthetic: true`; **record the returned uuid in a Veyra-owned in-memory registry that persists to `synthetic-resources.json`**. On ANY failure, call `cleanup` for everything in the registry so far and abort the scan before Exercise.
- `cleanup` semantics: read `synthetic-resources.json`; for each registered uuid, call `auth.admin.deleteUser(uuid, { shouldSoftDelete: false })` (hard delete); record per-uuid outcome. **DO NOT call `auth.admin.listUsers`** — listing pre-existing users would violate `§4.8`'s "agent never reads pre-existing user data" rule.
- `verify` semantics: for each uuid in the registry, attempt `auth.admin.getUser(uuid)`; expect HTTP 404 / "user not found" (counted as deleted). Any uuid that still resolves is a residual. **The agent only queries the specific uuids Veyra itself created — never enumerates the user table.**
- On residual > 0: emit `confirmed_issue + fix_before_launch` finding flagging the failed cleanup; non-zero exit.
- Emits `synthetic-resources.json` (the registry; the agent's bookkeeping spine) + `cleanup-proof.json` (receipt).

### Connector (`src/connectors/supabase/admin/`)

- Wrapper around `@supabase/supabase-js` with service-role key. Read key from env var named by `--supabase-service-role-key` (env-var name only, never the key itself on argv).
- Refuses to operate against a project_ref that matches any read-only Supabase project ref in the scan (sandbox must be distinct).
- Refuses to operate if **any** rows with the Veyra synthetic-data namespace prefix (`veyra-synth-` regardless of `scan_id`) already exist — catches orphans from any prior failed scan, not only the current one. Requires manual cleanup before this scan can proceed. The orphan-detection query is narrowly scoped to the namespace prefix; it does not enumerate the full user table.

## Done when

- Integration test: synthesize 3 identities → assert via per-uuid `auth.admin.getUser(uuid)` against the registry that 3 exist; run cleanup; assert per-uuid `getUser(uuid)` returns "not found" for all 3. **Listing the full user table is forbidden — the test must use the registry, same as the agent.**
- Partial-failure test: induce a failure mid-Synthesize → assert all previously created resources are rolled back; scan exits non-zero before Exercise.
- Induced-cleanup-failure test (kill the manager mid-Cleanup): assert non-zero exit + residual report + a `confirmed_issue` finding flagging the failed cleanup.
- `cleanup-proof.json` shape: `{ scan_id, created_count, deleted_count, residual_count, duration_ms, per_resource_log }`.
- Approval-file consumption: scan refuses to reuse the same approval file (per step 01 decision 5 outcome).

## Guardrails

- Per `§4.8`: agent never touches a resource it didn't create.
- Per `§4.8`: agent never reads pre-existing user data. **No `auth.admin.listUsers` call** — that would enumerate the user table. Verification is bookkeeping-driven via the Veyra-owned registry: only the specific uuids Veyra created are queried. Orphan detection (described below) is the one place a list-style query is acceptable, and it's scoped to the namespace prefix at construction time, not during a scan.
- Per `§11.2`: every resource tagged with `veyra_scan_id`; the fixed prefix on names (e.g. `veyra-synth-<scan_id>-`) makes orphan detection at construction time trivial. **Orphan detection** runs once at agent construction: if any pre-existing row with the Veyra namespace prefix is detected (via a narrow query scoped to that prefix only), the agent refuses to operate until manual cleanup. This is the only allowed broad-query path.
- Per `§11.3`: hard delete (`shouldSoftDelete: false`). Soft delete would leave rows that look like residuals to verification.
- Per `§1.1`: service-role key never appears in artifacts, logs, AI prompts, or reports. Args fingerprints are SHA-256.
- Per `FPP §2A`: handler routing is via registered `ConnectorId` — Phase 2 ships the Supabase handler; future Firebase / Clerk handlers drop in without changing the agent.

## References

- `PHASE_2_PLAN.md` §3.2 + §3.4 (Synthesize + Cleanup semantics), §4.8 (controls), §11.2 (namespace), §11.3 (cleanup proof)
- Supabase Admin SDK (only): `auth.admin.createUser` (synthesize), `auth.admin.deleteUser` (cleanup), `auth.admin.getUser(uuid)` (per-uuid verification). **`auth.admin.listUsers` is forbidden in the scan path** because it would enumerate the user table; the agent's registry replaces it.
- Step 03 `SandboxExecutor` (this agent calls into it)
- `.claude/skills/new-agent/SKILL.md`, `.claude/skills/new-connector/SKILL.md`
