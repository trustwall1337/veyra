# Step 06b — Test-actor manifest mode (operator-provided actors)

**Status:** not started
**Maps to:** `PHASE_2_PLAN §2 Mode B sub-mode B.1`; `REVISION_AI_SHAPE §3.3b RoleModel`
**Amends Phase 2 step:** none — new step file; sibling of 06 (synthetic-data-manager)
**Produces:** `src/agents/test-actor-manifest-reader/` + manifest schema at `src/types/test-actor-manifest.ts`
**Depends on:** Phase 2 step 02 (types), Phase 1 02b (`RoleModel` type)
**Executed by:** `/new-agent` skill
**Verification:** manifest-schema validation tests; sign-in round-trip against a fake Supabase Auth endpoint; verify-no-mutation guardrail

## Goal

Preferred first active-validation path. Operator pre-creates test users in their sandbox project, declares them in a YAML manifest, Veyra reads the manifest, signs in as each actor, and runs the catalog tests. **No service-role key required. No mutation by Veyra.**

Pairs with sub-mode B.2 (`auto-synthesize`, step 06) which is the higher-trust alternative.

## What lands

- `src/agents/test-actor-manifest-reader/agent.ts` — implements `VeyraAgent`. Reads the YAML file pointed at by `--test-actor-manifest`, validates the schema, signs in as each declared actor via `auth.signInWithPassword`, holds JWTs in memory, produces `synthetic-resources.json` shaped identically to step 06's output (so the sandbox-runner is unchanged).
- `src/types/test-actor-manifest.ts` — typed manifest schema:

```yaml
# test-actors.yaml — operator-authored
roles:
  admin:
    can_access: [/admin/*, all_invoices]
    cannot_access: []
  member:
    can_access: [own_invoices, own_tenant_files]
    cannot_access: [cross_tenant_invoices, /admin/*]
  viewer:
    can_access: [own_tenant_invoices (read-only)]
    cannot_access: [cross_tenant_resources, /admin/*]

test_actors:
  - email: admin@test.local
    password_env: TEST_ADMIN_PW
    role: admin
    tenant_id: t1
  - email: tenant-a-user@test.local
    password_env: TEST_USER_A_PW
    role: member
    tenant_id: t1
    owns:
      - { table: invoices, id: inv-A-1 }
  - email: tenant-b-user@test.local
    password_env: TEST_USER_B_PW
    role: member
    tenant_id: t2
    owns:
      - { table: invoices, id: inv-B-1 }
```

- The agent derives a `RoleModel` (revision §3.3b) directly from the manifest's `roles` section. Confidence is `'declared'` everywhere. Written to `role-model.json` for the catalog tests to read.
- Cleanup is a no-op: there's nothing Veyra-created to delete. The agent's `cleanup` method is documented as intentionally empty; cleanup-proof reports `created_count: 0`, `deleted_count: 0`, `residual_count: 0`.

## Done when

- Manifest schema validation: malformed YAML, missing required fields, unknown role names → reject at parse time with structured errors.
- Sign-in round-trip: stub Supabase Auth → assert the agent signs in as each declared actor, holds the JWT in memory, returns a session object the sandbox-runner can use.
- Password env-var enforcement: the manifest references `password_env` field names; agent reads the actual passwords from `process.env[<name>]`. **Never accept passwords inline in the manifest.** Parse-time check: any `password:` field (vs `password_env:`) → reject.
- No-mutation guardrail: import-graph test asserts this agent imports zero mutating Supabase Admin API methods (no `auth.admin.createUser`, no `auth.admin.deleteUser`, no service-role-key consumption).
- `role-model.json` produced with `confidence: 'declared'` for every entry.
- Cleanup is a no-op; `cleanup-proof.json` is well-formed but reflects zero Veyra-created resources.

## Guardrails

- **Constraint 5 enforced structurally:** this agent does not hold the service-role key. There is no env var named `--supabase-service-role-key` in this sub-mode. CLI rejects that flag combination at parse.
- Passwords are read from env vars only, never from the manifest file or argv. Manifest declares the env var name, not the password.
- **Constraint 6 enforced:** this sub-mode does not delete pre-existing user data. The agent never calls `deleteUser` for any UUID — that path is auto-synthesize-only.
- Per `FPP §2A`: manifest schema is YAML; loader uses opaque `RoleId` for role names (no hardcoded role-name union in shared types).
- If a declared actor's `owns` references a resource that doesn't exist in the sandbox project, the agent records the gap in `manifest-validation.json` and continues — catalog tests that need that resource emit `inconclusive` for that scenario.

## References

- `PHASE_2_PLAN.md §2 Mode B sub-mode B.1`
- `REVISION_AI_SHAPE.md §3.3b RoleModel` (declared-source path)
- Phase 2 step 06 (`synthetic-data-manager`, the auto-synthesize sibling)
- Phase 2 step 08 (`sandbox-runner`, the consumer of `synthetic-resources.json` — sub-mode-agnostic)
