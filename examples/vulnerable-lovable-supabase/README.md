# vulnerable-lovable-supabase (Veyra Phase 1 fixture)

This is the canonical broken-by-design fixture that Veyra Phase 1 is tested
against. Every check, every agent, and every reporter is validated against the
patterns seeded here.

**Do not copy any of this code into a real application.** Every file is
intentionally wrong.

## Layout

```
src/                   — minimal Vite + React app with seeded source-tree issues
supabase/schema.sql    — seeded SQL patterns (RLS off, USING (true), broad authed)
mcp-fixtures/          — replay payloads mimicking Supabase MCP responses
                         (storage bucket state cannot come from db dump)
expected-findings.json — manifest of what a scan must surface, keyed by control_id
expected-findings.test.ts — placeholder integration test; expands after step 19
```

## Seeded issues — `control_id` mapping

Numbers reference `FINAL_PRODUCT_PLAN.md §11` (the canonical 12 checks).

| `control_id` | Where it lives | Notes |
|---|---|---|
| `cc-11-1` | `src/App.tsx` (the `RequireUser` wrapper) | Frontend-only redirect, no server check |
| `cc-11-2` | `src/pages/AdminPage.tsx` | Admin route without server-side role check |
| `cc-11-3` | `src/pages/OrderPage.tsx` | Direct object access by id, no tenant filter |
| `cc-11-4` | `src/pages/DashboardPage.tsx` | Query uses client-provided `tenant_id` |
| `cc-11-5` | `supabase/schema.sql` — `public.users` | RLS disabled on sensitive table |
| `cc-11-6` | `supabase/schema.sql` — `public.orders` | `CREATE POLICY ... USING (true)` |
| `cc-11-7` | `src/lib/supabase-client.ts` | Service-role key bundled into client |
| `cc-11-8` | `src/lib/secrets.ts` | Hardcoded fake JWT (Gitleaks-detectable) |
| `cc-11-9` | `supabase/schema.sql` — `public.documents` | Policy `TO authenticated USING (true)` |
| `cc-11-10` | `package.json` | `axios@0.21.0` pinned (OSV-detectable CVE-2021-3749) |
| `cc-11-11` | (absence of `src/**/*.test.ts`) | No negative tests for protected routes |
| `cc-11-12` | `mcp-fixtures/supabase-storage-buckets.json` | Public bucket with `anon` select |

## False-positive controls (must NOT surface findings)

- `public.timezones` — lookup table, RLS on, permissive read by design.
- `public.feature_flags` — same pattern as `timezones`.
- `internal-reports` bucket — private; only `service_role` has access.

## Intentional dependency pin

`package.json` pins `axios@0.21.0` to seed `cc-11-10`. **Do not "fix" this** —
upgrading the pin removes the OSV finding the fixture is supposed to surface.

No lockfile (`package-lock.json` / `pnpm-lock.yaml`) is committed. OSV-Scanner
accepts `package.json` directly for the npm ecosystem, so the OSV adapter is
pointed at `package.json` as the `--lockfile` argument. Running `pnpm install`
inside the fixture would generate a lockfile; tests never need it.

## Hardcoded "secret"

`src/lib/secrets.ts` contains a JWT-shaped string that begins with `eyJ` and
ends with `REDACT_ME_fake_signature`. It is **not** a real key — the JWT payload
literally says `"fixture":"VEYRA_FIXTURE_DO_NOT_USE"`. Gitleaks should match it
on the JWT pattern; `--redact` will mask the value in output.
