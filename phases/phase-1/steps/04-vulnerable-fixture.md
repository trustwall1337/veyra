# Step 04 — Vulnerable Lovable+Supabase fixture project

**Status:** not started
**Maps to:** `PHASE_1_PLAN §6 Required` (vulnerable fixture) + §8 success criteria; `FINAL_PRODUCT_PLAN §11` (12 initial checks); step 14 `controls.ts` (canonical catalog)
**Produces:** `examples/vulnerable-lovable-supabase/` populated with broken-by-design app + `expected-findings.json` + `mcp-fixtures/`
**Depends on:** 02
**Executed by:** plain coding pass
**Verification:** checked-in `expected-findings.json`; integration assertion under `pnpm test` (initially vacuous; becomes the gate after step 19)

## Goal

Build the canonical target the rest of Phase 1 is tested against. Every check, every agent, every reporter validates here. Build it early so every later step is "make this finding appear," not "design an abstraction."

The canonical control catalog is owned by step 14 (`src/agents/evidence-report/controls.ts`). The fixture's seeded patterns and `expected-findings.json` reference `control_id` values from that catalog — never duplicate the check list.

## What lands

### Source-tree fixtures (detectable via static analysis)

- `examples/vulnerable-lovable-supabase/package.json` — minimal Vite + React app.
- `examples/vulnerable-lovable-supabase/src/` — seeded vulnerabilities, each tagged with its `FINAL_PRODUCT_PLAN §11` check number:
  1. **§11.1** Frontend-only protected route (redirect-on-load with no server check)
  2. **§11.2** Admin route without server-side role check
  3. **§11.3** Direct object access by ID without user/tenant filter
  4. **§11.4** Query using client-provided `tenant_id`
  5. **§11.7** Client-side privileged Supabase key usage (anon vs service role mismatch)
  6. **§11.8** Hardcoded API key / Supabase service role key in source (Gitleaks-detectable)
  7. **§11.10** Vulnerable dependency pinned in `package.json` (OSV-detectable)
  8. **§11.11** Missing negative tests for protected routes

### Schema fixtures (detectable via schema parser)

- `examples/vulnerable-lovable-supabase/supabase/schema.sql` — seeded SQL patterns (note: storage bucket state is NOT here — see below):
  1. **§11.5** Sensitive table with RLS disabled (`users`, `orders`, etc.)
  2. **§11.6** Sensitive table with `CREATE POLICY ... USING (true)`
  3. **§11.9** Table with policy granting all rows to `authenticated` role without per-row check
- At least **2 seeded clean tables** (per §8 false-positive control). Example: `public.timezones` lookup table with RLS-on + read-only policy that produces no finding.

### Storage-bucket fixtures (MCP-derived ONLY)

Supabase `db dump` excludes managed schemas including `storage`, so bucket public/private state is not in `schema.sql`. The fixture provides mock MCP responses instead:

- `examples/vulnerable-lovable-supabase/mcp-fixtures/supabase-storage-buckets.json` — mock Supabase MCP `list_storage_buckets` + `get_storage_config` response:
  - **§11.12** A public bucket with `select` granted to `anon` (the planted issue)
  - ≥1 private bucket that produces no finding (clean control)
- The supabase-rls agent (step 09) reads this artifact when Supabase MCP is configured. Without MCP, bucket findings are reported as `coverage_gap`.

### Expected findings manifest

- `examples/vulnerable-lovable-supabase/expected-findings.json` — `{ must_surface: [...], must_not_surface: [...] }` keyed by `control_id` matching step 14's `controls.ts`. Each entry flags whether the finding depends on MCP (e.g. §11.12 bucket finding is `must_surface` only when `--supabase-mcp` is set; otherwise `must_be_coverage_gap`).

## Done when

- Fixture contains all 12 §11 patterns (8 in source tree, 3 in schema.sql, 1 in mcp-fixtures) AND ≥2 seeded clean tables AND ≥1 clean bucket.
- `expected-findings.json` enumerates findings by `control_id` with explicit MCP-dependency flags.
- A placeholder Vitest integration test loads `expected-findings.json` (initially asserts the file is well-formed; expands to compare against real scan output after step 19).
- Running `pnpm install` inside the fixture works.

## Guardrails

- The hardcoded "secret" must be obviously fake (`sk_test_FAKE_DO_NOT_USE`, `eyJ...REDACT_ME`).
- Do not commit any real third-party credential, even expired.
- The fixture is example code, not production code; no claims of correctness anywhere in source comments.
- Don't add `.env` or `.env.example` files with values that look like real keys.
- The fixture's `package.json` may pin a known-vulnerable version (e.g. `axios@0.21.0`) — document in a fixture README so future devs don't "fix" it.
- The `mcp-fixtures/` directory is for replaying MCP responses in tests; must not be presented as a real export from a Supabase project — add a comment header in the file.
- `expected-findings.json` is keyed by `control_id`, NOT by free-form check names. Renaming a `control_id` in `controls.ts` requires updating this file in the same commit.

## References

- `PHASE_1_PLAN.md` §6 (Required deliverables), §8 (Success criteria)
- `FINAL_PRODUCT_PLAN.md` §11 (12 initial checks — authoritative reference for control IDs)
- Step 14 `controls.ts` (canonical control catalog)
- Supabase CLI docs: `supabase db dump` excludes managed schemas (including storage)
- existing: `examples/vulnerable-lovable-supabase/.gitkeep`
