# Supabase metadata — what Veyra reads, and how to export it

Derived from `phases/phase-1/PHASE_1_PLAN.md §4.4` (Supabase RLS
controls) and `CLAUDE.md §MCP discipline`.

Veyra reads Supabase metadata two ways: through MCP (when configured)
and through a local `schema.sql` export (always). Both paths are
read-only.

## The MCP path (`--supabase-mcp <project_ref>`)

The Supabase connector enforces the following on every tool call:

- `read_only=true` is **derived from the active ValidationPolicy** and
  forwarded to the transport. The connector does not hardcode it.
  Under Phase 1's `read_only_evidence` policy `read_only` is `true`;
  future modes may relax this only with explicit approval.
- `project_ref` is required. A call without it is rejected before the
  transport.

### Allowed tools (Phase 1)

- `list_tables`
- `list_extensions`
- `list_migrations`
- `get_advisors`
- `get_logs` — only when the active policy includes
  `read_application_logs`. Production logs can carry PII / secrets /
  session tokens, so this requires explicit policy upgrade.
- `list_edge_functions`
- `get_edge_function`
- `list_storage_buckets`
- `get_storage_config`

### Denied tools (regardless of policy)

- `execute_sql` — denied even with `read_only=true`. Per §4.4: "Do not
  query user data." Schema-shape data comes from `list_tables` +
  `get_advisors`.
- `apply_migration` — mutating.
- `deploy_edge_function` — mutating.
- Branch tools — mutating.
- `update_storage_config` — mutating.
- Anything not on the allowlist.

### Why `execute_sql` is denied even though it would work read-only

Read-only `execute_sql` can still return user rows. Veyra's design rule
is "do not query user data." Schema shape (table names, columns, RLS
status, advisors) is sufficient for the cc-11-5 / cc-11-6 / cc-11-9
predicates and avoids any path that returns rows.

## The local `schema.sql` path

If you prefer not to use MCP, export the schema with the Supabase CLI:

```sh
supabase db dump --schema public > schema.sql
veyra scan --project ./my-project --supabase-schema ./schema.sql
```

What `supabase db dump` includes: tables, policies, grants, indexes,
constraints in the `public` schema.

What it does **not** include: managed schemas. Storage bucket
public/private state lives in the `storage` schema, which the dump
excludes. Without `--supabase-mcp`, the `cc-11-12` control surfaces as
`coverage_gap` — never as silent absence — and the report explains how
to enable bucket-state checks.

## What Veyra does with this metadata

- The supabase-rls predicate set reads `list_tables` / parsed
  `schema.sql` to fire cc-11-5 (sensitive table without RLS), cc-11-6
  (USING (true) on a sensitive table), and cc-11-9 (TO authenticated
  without per-row check).
- `list_storage_buckets` + `get_storage_config` drive cc-11-12.

The regex schema parser supports the common patterns documented in
`phases/phase-1/steps/09-agent-supabase-rls.md`. Unparseable blocks
(CTEs, DO $$, multi-statement policies, non-public schemas) emit
`coverage_gap` findings with `reproducibility: manual_review_required`
— never silent acceptance.
