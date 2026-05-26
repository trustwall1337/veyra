# Phase 2 active validation

Active validation runs negative tests against a customer-owned
sandbox. Veyra creates synthetic identities, exercises specific
controls, and asserts whether the system denied or allowed the
unauthorized action. This is the only place in Veyra that mutates a
customer system — and it only does so in a sandbox the customer
explicitly approves.

## Mode A vs Mode B

- **Mode A — `read_only_evidence` (default).** Phase 1's
  deterministic baseline. Reads code, schema metadata, scanner
  outputs. Never mutates. Available in every environment, including
  production.
- **Mode B — `sandbox_active_validation`.** Active validation. Runs
  the negative-test catalog against a sandbox Supabase project the
  customer authorises via a signed approval file. Refused in
  production at the policy factory boundary (per step 2.03 codex
  P203-002). Refused at parse-time without `--approve-active` (per
  step 2.11).

## Two sub-modes within Mode B

Per step 2.01 decision 10, the **documented happy path** is sub-mode
B.1 (manifest mode). B.2 (auto-synthesize) is a power-user opt-in
because B.2 requires a Supabase service-role key — a much bigger
trust ask.

### B.1 — Manifest mode (default)

Operator pre-creates test users in their sandbox, declares them in
a YAML manifest, Veyra reads the manifest and signs in as each
actor. No service-role key needed.

```yaml
# test-actors.yaml
roles:
  admin:
    can_access: [/admin/*, all_invoices]
    cannot_access: []
  member:
    can_access: [own_invoices, own_tenant_files]
    cannot_access: [cross_tenant_invoices, /admin/*]

test_actors:
  - email: admin@test.local
    password_env: TEST_ADMIN_PW
    role: admin
    tenant_id: t1
  - email: alice@test.local
    password_env: TEST_ALICE_PW
    role: member
    tenant_id: t1
    owns:
      - { table: invoices, id: inv-A-1 }
```

Passwords are NEVER inline. The manifest declares `password_env`
(env-var NAMES); the agent reads passwords from
`process.env[<name>]` at runtime. Inline `password:` fields are
refused at parse-time.

### B.2 — Auto-synthesize (power-user opt-in)

Veyra creates synthetic users via the Supabase Admin API. Requires
`--supabase-service-role-key VEYRA_TEST_SRK` (env-var NAME; the
key value never appears on argv). Per step 2.06: all-or-nothing
synthesize (any failure rolls back), hard delete on cleanup, bounded
auto-retry (1s/4s/16s, max 3 attempts), residual_count after retry
exhaustion → `confirmed_issue` + `fix_before_launch`.

## What's checked

Phase 2 ships 13 active-validation controls (step 2.07 + 2.07d):

- `cc-11-1` — unauthenticated access to frontend-only-protected route
- `cc-11-2` — non-admin to /admin route
- `cc-11-3` — direct object access across tenants
- `cc-11-4` — client-supplied tenant_id override
- `cc-11-5` — cross-tenant read when RLS is off (multi-variant)
- `cc-11-6` — broad `USING (true)` RLS policy
- `cc-11-9` — all-authenticated policy lets actor read other tenants
- `cc-11-12` — anonymous read on private storage bucket
- `cc-11-13a..e` — PostgREST query-surface checks (OpenAPI probe,
  select=* leak, neq/or filter bypass, foreign-table embed leak,
  filter-on-private-column)

Customers cannot author custom executable test types in Phase 2
(per step 2.01 decision 9). The catalog is closed; the AI Security
Planner (step 2.07b) only selects + parameterises catalog entries.

## What active validation never does

- No SQL injection payloads.
- No fuzzing.
- No table-name brute force.
- No filter-value brute force.
- No destructive operations (GET only in the catalog tests).
- No production environment.
- No cleanup-via-listUsers (the synthetic-data manager only queries
  the specific UUIDs it created, never enumerates the user table).
