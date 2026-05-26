# Step 26 — Schema parser handles real `pg_dump` syntax, fails loudly when it can't, and inventory ignores Veyra's own output

**Status:** done (2026-05-26)
**Maps to:** none of the planned sections directly — surfaced by the first live `--supabase-schema` scan against a real Supabase project's `supabase db dump --linked` output on 2026-05-25. Three issues live in already-"done" steps (09b supabase-rls predicate / its schema parser, 17b deterministic bootstrap inventory). The regex/line-based schema parser was a knowing trade-off recorded in CLAUDE.md `§Resolved engineering decisions` — that decision held while the only consumer was the seeded fixture, and inverts now that real customer dumps don't parse.
**Amends Phase 1 step:** none (no contract changes; this fixes detection-correctness gaps inside two existing agents)
**Produces:** parser updates in `src/agents/supabase-rls/` (or wherever the schema-parsing code lives), one new file-exclusion default in `src/agents/product-understanding/` (the bootstrap-inventory composer), and new end-to-end + parser unit-test assertions in `src/cli/end-to-end-fixture.test.ts` plus the supabase-rls parser test file.
**Depends on:** 09b (supabase-rls predicate + parser contract), 17b (bootstrap inventory), 21 + 22 (the gates that proved the orchestrator path so we know parser bugs surface here cleanly), 24 (the wiring that lets a follow-up scan against a real DB exercise this path).
**Executed by:** plain coding pass + `step-reviewer` subagent at the end + a fixture re-run via `src/cli/end-to-end-fixture.test.ts` AND a new real-pg_dump regression test using a recorded minimal real-shape dump.
**Verification:** `pnpm test --run` exits 0 (full suite, currently 492 tests + the new assertions this step adds). The deterministic baseline against the seeded fixture (`--supabase-schema examples/vulnerable-lovable-supabase/supabase/schema.sql`) still produces step-23's gates. A new minimal real-pg_dump fixture (≤30 lines, captured from a real `pg_dump` output, no real customer data) parses to ≥1 table and ≥1 policy. A new "parser produces 0 from non-trivial input" test asserts the agent emits a `parse_failure` `coverage_gap` ScanFact instead of silently returning empty.

## Goal

On 2026-05-25 the first live scan with a real `supabase db dump --linked` produced a 2549-line dump containing **42 `CREATE TABLE`, 105 `CREATE POLICY`, 41 `ENABLE ROW LEVEL SECURITY` lines**. The supabase-rls parser produced `{"tables":[],"policies":[],"grants":[],"unparseable":[]}` — zero of everything. The four schema-driven controls (cc-11-5/6/9/12) then silently produced zero findings and the report rendered `needs_review` for them without any uncertainty note telling the operator that the parser had failed. This is the worst possible failure mode for a security tool: a quiet false-negative dressed as `needs_review`.

This step does three things, in priority order:

1. **Fix the parser** so it handles the syntax Supabase's own CLI emits — quoted schema-qualified identifiers (`"public"."users"`), `IF NOT EXISTS`, and the surrounding pg_dump preamble.
2. **Fail loudly when the parser can't make sense of its input** — emit a `parse_failure` `coverage_gap` ScanFact tagged to the four schema-driven controls, with a clear uncertainty note saying what went wrong. Per CLAUDE.md `§Output language`: only allowed claims.
3. **Stop the bootstrap inventory from walking into Veyra's own output.** Today the inventory file_map shows entries like `.veyra/scans/<earlier-scan-id>/scan-trace.json` and `supabase/.temp/cli-latest`. That noise lives in the "Observed evidence" section of the report and confuses the operator.

This is not a design change. Artifact shapes, control contracts, and the parser's interface stay the same. The fixes are localised to the parser regex set, one helper that gates `coverage_gap` emission, and one file-walk filter.

## Observed

The live run on 2026-05-25 against a real Supabase project produced this evidence (all paths under `/tmp/supabase-only-scan/.veyra/scans/2026-05-25T16-58-10-306Z-ea8f6461/`):

- `supabase-tables.json` content: `{"tables":[],"policies":[],"grants":[],"unparseable":[]}` — 73 bytes.
- `scan-trace.json` lists all 7 agents including `supabase-rls` with `status: ok`. The orchestrator path is fine; the parser is the failure.
- `readiness-report.json.control_cards`: cc-11-5, cc-11-6, cc-11-9 all show `needs_review` with 0 findings. cc-11-12 has 1 finding from a non-schema source. No uncertainty note explains the empty schema model.
- `inventory-bootstrap.json.observed_evidence.file_map` includes `.veyra/scans/2026-05-25T15-51-05-955Z-2c6c6b9b/...` (a prior scan's output) and `supabase/.temp/cli-latest` etc. (Supabase CLI metadata).

The source dump (`/tmp/supabase-only-scan/schema.sql`) opens with `SET statement_timeout = 0;`, declares `CREATE SCHEMA IF NOT EXISTS "public";`, uses `CREATE TABLE IF NOT EXISTS "public"."appetite_insurers" (...)`, and uses `ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;`. The fixture's `schema.sql` uses unquoted, schema-bare forms (`CREATE TABLE public.users (...)`, `ALTER TABLE public.users ENABLE ROW LEVEL SECURITY`). The regex set was tuned to the fixture's syntax only.

## What lands

Three concrete code changes plus tests.

### Piece 1 — Parser extensions in `src/agents/supabase-rls/` (whichever file owns the regex set)

Audit the existing regex set against real `pg_dump` output. Add support for:

- **Quoted identifiers everywhere.** Tables, schemas, columns, policy names all appear as `"public"."appetite_insurers"`, `"users"`, `"public"."some policy with space"`. The current parser likely matches `\w+` not `"\w+"|\w+`.
- **`IF NOT EXISTS` clauses.** `CREATE TABLE IF NOT EXISTS "public"."x" (` and `CREATE SCHEMA IF NOT EXISTS "public"`.
- **Schema-qualified RLS statements.** `ALTER TABLE "public"."x" ENABLE ROW LEVEL SECURITY;` rather than `ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;`.
- **Schema-qualified policies.** `CREATE POLICY "p" ON "public"."x" ...` with USING/WITH CHECK on the same statement or following lines.
- **Multi-line USING/WITH CHECK expressions.** Real dumps break long expressions across multiple lines; the line-based parser must accumulate.
- **Lines to deliberately skip.** `SET ...`, `SELECT pg_catalog.set_config(...)`, `COMMENT ON ...`, `ALTER ... OWNER TO ...`, `CREATE TYPE ... AS ENUM (...)`, `CREATE FUNCTION ...`, `CREATE EXTENSION ...`, `GRANT ... ON ... TO ...`, `REVOKE ... ON ... FROM ...`. These should not pollute `unparseable[]`; they're not parser failures, they're known-irrelevant-to-Phase-1 statements.

Per CLAUDE.md `§Resolved engineering decisions`: this step does NOT introduce the `pgsql-parser` (libpg_query Wasm) dependency. The parser stays regex/line-based. If the regex extensions prove brittle in practice (more than 1 real-world dump produces empty output after this step), the cost/benefit on adding pgsql-parser flips and it becomes a separate Phase 2 conversation — flagged but not done here.

Per CLAUDE.md `§No any`: extend the parser's typed output, don't loosen types to make new shapes fit.

### Piece 2 — Loud failure when the parser produces nothing from a non-trivial dump

In whichever file owns the parser's top-level entry point, after the regex pass:

```typescript
// pseudocode — actual interface depends on existing types
if (
  schemaSnapshot.tables.length === 0 &&
  schemaSnapshot.policies.length === 0 &&
  rawInput.byteLength > MIN_NONTRIVIAL_DUMP_BYTES // e.g. 1024
) {
  return emitParseFailureCoverageGap({
    affected_controls: ['cc-11-5', 'cc-11-6', 'cc-11-9', 'cc-11-12'],
    summary: 'schema parser produced 0 tables and 0 policies from a non-empty dump — input may use syntax newer than the parser supports',
    where_found: schemaPath,
    uncertainty_notes: [
      `dump size: ${rawInput.byteLength} bytes`,
      `lines with CREATE TABLE: ${countMatches(rawInput, /CREATE TABLE/g)}`,
      `lines with CREATE POLICY: ${countMatches(rawInput, /CREATE POLICY/g)}`,
      `lines with ENABLE ROW LEVEL SECURITY: ${countMatches(rawInput, /ENABLE ROW LEVEL SECURITY/g)}`,
    ],
  });
}
```

The exact emit-point follows the existing agent contract (ScanFact, AssertionPredicate). The point is: the agent **must not silently return an empty SchemaSnapshot when the input was non-trivial.** The four affected controls then surface `coverage_gap` in the report with the uncertainty note, instead of `needs_review` with no findings and no explanation.

Per CLAUDE.md `§Output language`: the uncertainty note uses only allowed claims ("the parser produced 0 results", "input may use syntax newer than supported"). No "secure", "safe", "compliant".

Per CLAUDE.md `§Extensibility-first`: the affected-control list is a property of the parser's failure mode (the parser knows which controls it would have covered), not a switch on `if (parser_id === 'regex')` somewhere else.

### Piece 3 — Inventory file-walk excludes Veyra's own scan output and Supabase CLI temp metadata

In `src/agents/product-understanding/` (the bootstrap-inventory composer), add to the existing file-walk's exclusion list:

- `.veyra/` — Veyra's own scan output directory.
- `supabase/.temp/` — Supabase CLI's temp metadata.

Both as directory prefixes, not just exact matches. The exclusion is unconditional; there's no reason a Phase 1 scan should ever walk into either. This is one defensive line, not new logic.

Add an assertion in the end-to-end test: `inventory-bootstrap.json.observed_evidence.file_map` contains no entries starting with `.veyra/` or `supabase/.temp/`.

## Done when

All of the following hold in a single fresh test run:

1. **Real-shape parsing works.** A new test using a minimal real-pg_dump fixture (a ≤30-line snippet captured from real `supabase db dump` output, no customer data, checked into the repo under `src/agents/supabase-rls/__fixtures__/real-pgdump-minimal.sql` or similar) parses to ≥1 table with `rls_enabled` set correctly and ≥1 policy with a USING expression captured.
2. **Existing fixture still parses.** The seeded `examples/vulnerable-lovable-supabase/supabase/schema.sql` continues to parse with the same shape it does today. Step 23's gates A–D still pass on it. No regression.
3. **Loud failure is loud.** A new test feeds the parser a 5KB blob of unparseable text (or a too-new dump shape) and asserts the agent emits a `parse_failure` `coverage_gap` ScanFact tagged to cc-11-5/6/9/12 with an uncertainty note that names byte count and CREATE-TABLE line count.
4. **Inventory exclusions hold.** The end-to-end test asserts `inventory-bootstrap.json.observed_evidence.file_map` contains zero entries beginning with `.veyra/` or `supabase/.temp/`, even when those directories exist on disk under `--project`.
5. **End-to-end gate (step 22) stays green** on the existing fixture under `pnpm test --run`.
6. **Live re-run** (informal verification, not part of `pnpm test`): the 2026-05-25 real-DB scan re-run produces a non-empty `supabase-tables.json` AND the report's cc-11-5/6/9/12 cards either show real findings OR show `coverage_gap` with a clear uncertainty note — not silent `needs_review` with 0 findings.
7. **No new dependencies.** `package.json` is unchanged. `pgsql-parser` / libpg_query stays off the dep tree per the decision record.
8. **Output language clean.** `output-language-lint` clean over the new uncertainty-note strings.

## Failure modes and what they mean

- **Regex extensions land, real dump still parses to 0.** The dump shape contains another syntactic variant the new regexes don't cover. Capture the offending line into the test fixture and add to the regex set — don't loosen the test.
- **Loud-failure path fires on the seeded fixture.** Means the parser regressed on the fixture's syntax during the change. Fix the parser; do not skip the test on the fixture.
- **Inventory exclusion accidentally drops a legitimate path.** A project that genuinely has a top-level `.veyra/` directory it owns (unlikely but possible) would be invisible to the walk. Document the exclusion in CLI help text or README so this surprises no one.
- **Step 24's MCP-driven branch starts emitting `parse_failure`.** That means the MCP-sourced SchemaSnapshot path is also returning empty — separate bug, separate step. Don't muffle the failure to hide it.

## Guardrails

- Do NOT add `pgsql-parser` / libpg_query / any pg-grammar parser dependency in this step. The decision record (CLAUDE.md `§Resolved engineering decisions`) keeps it out; if cost/benefit flips later, that's a separate planning-level conversation.
- Do NOT widen the schema-parser surface to handle non-`pg_dump` SQL dialects (Prisma migrations, Drizzle schemas, etc.). Phase 1 reads `supabase db dump` output only. Cross-dialect support is Phase 2 if anything.
- Do NOT loosen the "non-trivial input → loud failure" threshold to make a flaky test pass. The whole point is operators see a clear message when the parser is overwhelmed.
- Do NOT widen the inventory exclusion list to "anything that looks generated." Only the two specific directories that surfaced in the real run land in this step. Future exclusions are case-by-case.
- Per CLAUDE.md `§Output language`: every new string ("the parser produced 0 results", "input may use newer syntax", "coverage gap: schema parser failed") goes through `output-language-lint`. No "secure", "safe", "compliant".
- Per CLAUDE.md `§Extensibility-first`: no switches on parser id, scanner id, or connector id in shared code. Failure modes are properties of the parser, not branches in core.
- Per CLAUDE.md `§Secrets`: the dump file may contain function bodies that look like secrets to gitleaks. Don't echo dump contents in error messages; cite line numbers + byte ranges instead.

## Notes for the implementer

- The minimal real-pg_dump test fixture should be a *de-novo* small snippet — don't copy any real customer's dump even with names changed. Build a 25-30 line example with: `SET statement_timeout = 0;`, one `CREATE SCHEMA IF NOT EXISTS "public";`, two `CREATE TABLE IF NOT EXISTS "public"."x"` (one with one without RLS), two `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, one `CREATE POLICY "p" ON "public"."x" USING (...)`, plus the common SET/OWNER preamble lines the parser must learn to skip.
- The `MIN_NONTRIVIAL_DUMP_BYTES` threshold is a tunable. Start at 1024 bytes — a real `pg_dump --schema public` is always at least that. Make it a named constant, not a magic number, so step 27+ can revisit if it bites.
- The "exclusion list" for the bootstrap inventory should live in the same place existing exclusions (if any — `node_modules/`, `.git/`) are defined. Don't introduce a parallel mechanism.
- This step exists because the live-run feedback loop is the only thing that surfaces fixture-tight bugs. Document in the step file's "Notes" section that step 26 is the first concrete answer to "what breaks when Veyra meets a real customer's dump?" — and treat the discovery itself as evidence the live-run loop should run more often.

## References

- The live run that exposed this: `/tmp/supabase-only-scan/.veyra/scans/2026-05-25T16-58-10-306Z-ea8f6461/supabase-tables.json` (73 bytes, empty) + `readiness-report.json` (cc-11-5/6/9 all `needs_review` with 0 findings, no uncertainty note) + `inventory-bootstrap.json.file_map` (contains `.veyra/scans/<prior>/...` and `supabase/.temp/...`).
- The dump source: `/tmp/supabase-only-scan/schema.sql` — 2549 lines, 42 CREATE TABLE, 105 CREATE POLICY, 41 ENABLE ROW LEVEL SECURITY (per `grep -c`).
- `phases/phase-1/steps/09b-supabase-rls-as-assertion-predicate.md` — supabase-rls agent contract this step keeps stable.
- `phases/phase-1/steps/17b-deterministic-bootstrap-inventory.md` — bootstrap inventory contract this step extends with one exclusion.
- `phases/phase-1/steps/22-19b-gate-end-to-end-rewire.md` — end-to-end harness this step extends with the inventory-exclusion + loud-failure assertions.
- `phases/phase-1/steps/24-supabase-mcp-actually-wired.md` and `phases/phase-1/steps/25-supabase-mcp-production-transport.md` — sibling Supabase work; step 26 fixes a parser used by both branches.
- `CLAUDE.md §Resolved engineering decisions` — the decision record on regex parser; this step keeps it intact.
- `CLAUDE.md §Output language`, `§Extensibility-first architecture`, `§Secrets` — non-negotiable rules this step honours.
