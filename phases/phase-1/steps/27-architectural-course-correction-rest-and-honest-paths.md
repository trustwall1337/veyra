# Step 27 — Audit and correct the wrong architectural assumptions surfaced by first-customer UX testing

**Status:** done (2026-05-26)
**Maps to:** none of the planned sections directly — this is a course-correction step surfaced by 2026-05-25/26 live UX testing against a real Supabase project. Several Phase 1 architectural choices that looked clean on paper produced an "assemble-it-yourself security tool" customer experience: manual GitHub clone, multiple CLI installs (Node 22, gitleaks, osv-scanner, supabase CLI, npx), manual env-var setup, an `npx`-spawned MCP subprocess that drops env vars under the official MCP Inspector. These outcomes invalidate the "one command, one report" framing and need to be reckoned with at the planning level, not patched per-symptom.
**Amends Phase 1 step:** none directly; touches the contracts of step 16 (Supabase MCP connector) and the Phase 1 plan's §4.5 data-source approach. The current connector stays as one allowed backend; this step introduces a wider seam.
**Amends CLAUDE.md:** Yes — the locked rule "Supabase storage bucket state comes from MCP only" is amended by this step (storage metadata may come from REST or MCP behind the same `allowed_actions` gate). The line in CLAUDE.md is updated as part of this step's `What lands`. No other CLAUDE.md rules are touched.
**Produces:** (a) updated `phases/phase-1/decisions.md` recording the six wrong assumptions and the chosen direction for each; (b) narrower capability interfaces in `src/types/`: `DatabaseMetadataSource`, `StorageMetadataSource`, `CodeSource` (no umbrella `ProjectDataSource`); (c) a first concrete implementation that fetches Supabase database metadata via the Supabase Management REST API (no MCP subprocess), scoped to verified-and-stable v1 endpoints only; (d) an honest Lovable-path decision (parse-time reject with deferred-to-step-28 message); (e) documented developer-vs-customer flag separation; (f) explicit acknowledgment of the still-unsolved local-clone gap for Lovable; (g) a one-time REST-endpoint contract-test (recorded from a real Supabase project against verified endpoints) so recorded-contract / parser / shape drift surfaces in CI; live Supabase API drift is opt-in via `VEYRA_LIVE_TESTS=1`.
**Depends on:** 24, 25, 26 (steps that exposed the problem); FPP §2A (extensibility-first); CLAUDE.md §Validation policy (capability gating, not binary `read_only`).
**Executed by:** plain coding pass + `mcp-policy-check` subagent (any retained MCP path still under the gate) + `step-reviewer` subagent at the end + a real-DB smoke test against the user's sandbox project.
**Verification:** `pnpm test --run` exits 0 (full suite + new assertions). A live scan against the user's sandbox Supabase project using only `export SUPABASE_ACCESS_TOKEN=... && pnpm dev -- scan --project <empty-dir> --supabase <project_ref>` (no `--supabase-mcp`, no `--supabase-schema`, no manual `supabase db dump`, no `npx`-spawn) produces real findings on the schema-driven controls OR a per-capability `coverage_gap` with the REST error-derived reason when an endpoint legitimately rejects.

## The six wrong assumptions documented

Surfaced over the 2026-05-25/26 live runs and the codex first-review of this step's earlier draft. Each one shaped a step that's now "done" but produced bad UX or hides a remaining gap.

1. **Wrong assumption A — "MCP is the right transport for fetching Supabase database metadata."** The original Phase 1 plan committed to Supabase MCP for live schema reads. In practice the MCP path requires spawning `npx @supabase/mcp-server-supabase@latest` as a subprocess, plus the official MCP Inspector for debugging — which strips env vars and drops `SUPABASE_ACCESS_TOKEN`, masking auth failures as protocol failures. **The Supabase Management REST API exposes the same metadata via plain HTTPS with a Bearer token, no subprocess, no env-propagation hazard, no MCP protocol overhead.** MCP is the right tool for AI clients consuming heterogeneous tool surfaces; it is the wrong tool for a deterministic schema reader. This step demotes MCP from primary to alternative backend. **What MCP is NOT being replaced for: PostgREST query-surface checks in Phase 2 (cc-11-13a..e) which use the database-query API surface; those remain Phase 2 work and are out of scope here.**

2. **Wrong assumption B — "Lovable MCP works the same as Supabase MCP."** Live confirmation from Lovable on 2026-05-25 established that Lovable's MCP server uses OAuth from inside the calling MCP client only — there is no static personal-access-token equivalent. Veyra cannot drop into Lovable's MCP without implementing a full OAuth client. The current `--lovable-mcp` flag is therefore an honest dead end. **Decision (codex Q3): pick option B — parse-time reject with a clear "OAuth client required; deferred to step 28" message; the flag stays hidden from customer-facing docs until step 28 lands.**

3. **Wrong assumption C — "Local CLI with a long prerequisite list is acceptable."** Phase 1's customer surface today requires: Node 22, pnpm, gitleaks, osv-scanner, supabase CLI, npx, two env vars, manual GitHub clone, manual `supabase db dump`, manual schema export, manual restart when MCP Inspector drops env vars. The customer-facing framing of "one command, one report" is contradicted by the actual ladder. The Phase 1 `FPP §18 Not Required` list explicitly closes the door on a hosted product for trust-model reasons; that closure remains binding. This step does NOT flip the hosted/local decision (planner-level conversation). It DOES shrink the prerequisite list: drop `supabase CLI` (replaced by REST), drop the `npx`-spawn (replaced by REST), and document the irreducible local-first floor (Node 22 + pnpm + gitleaks + osv-scanner). **Decision (codex Q5): we do NOT replace gitleaks/osv-scanner with HTTP-based equivalents; uploading code or dependency data to remote scanners would break the local-first trust posture. Follow-up: a Phase 2+ "bundle/cache managed binaries" task to reduce install friction without breaking the trust property.**

4. **Wrong assumption D — "Fixture/dev flags are acceptable customer flows when the customer flow is broken."** `--supabase-schema` was introduced as a fixture-and-developer flag; through live testing it kept being offered to the user as a customer path because the customer path (`--supabase-mcp`) didn't work. This step formalises: customer flags vs developer flags are separately documented. **Decision (codex Q4): developer flags use `--dev-*` prefix AND require `VEYRA_DEV=1` env to be set; the help text hides `--dev-*` flags by default. Two locks together so a single accidental copy-paste from a contributor's terminal doesn't activate them in customer use.**

5. **Wrong assumption E — "Local clone is acceptable customer automation for Lovable" (added per codex finding 6).** Even after step 27 lands, the Lovable code-read path is still "customer runs `git clone` against the GitHub repo Lovable backs their project with." That's manual work. Step 27 does NOT solve this; it explicitly acknowledges it as a remaining Phase 1 limitation. The Lovable code read becomes part of the new `CodeSource` capability interface, with `local-git-clone` as the only Phase 1 implementation. A future step (call it 29 or push to Phase 2) builds either Veyra-driven `git clone` automation or — better — the OAuth-based Lovable file-fetch path. This step's job is to not pretend the gap is solved.

6. **Wrong assumption F — "Artifact and source names should be transport-shaped" (added per codex finding 6).** Existing artifact names — `supabase-mcp`, `supabase-schema`, `supabase-tables` — encode the transport (MCP vs SQL file) rather than the capability (database metadata vs storage metadata). This breaks down as soon as a second backend appears. Step 27 normalises around capability discriminators: `database-metadata.json`, `storage-metadata.json`, `code-evidence.json`. The current files stay as compatibility aliases for one Phase 1 release; new code reads the capability-shaped names; the next step removes the aliases.

## The seam (the "clean, scalable, expandable" architecture this step lands)

Per codex Q1: narrower capability interfaces, not one wide `ProjectDataSource`. The Phase 2 active-validation steps need `CodeSource` separately from `DatabaseMetadataSource`, and `StorageMetadataSource` is independent of both.

```
// src/types/data-sources.ts (sketch — final names TBD in implementation)
export interface DatabaseMetadataSource {
  readonly id: DataSourceId;             // opaque branded id per FPP §2A
  fetchTables(): Promise<Result<TableSnapshot[], DataSourceError>>;
  fetchPolicies(): Promise<Result<PolicySnapshot[], DataSourceError>>;
}

export interface StorageMetadataSource {
  readonly id: DataSourceId;
  fetchBuckets(): Promise<Result<BucketSnapshot[], DataSourceError>>;
  fetchStorageConfig(): Promise<Result<StorageConfig, DataSourceError>>;
}

export interface CodeSource {
  readonly id: DataSourceId;
  walk(): Promise<Result<FileWalkResult, DataSourceError>>;
  readFile(path: string): Promise<Result<string, DataSourceError>>;
}
```

Then:

- `src/data-sources/supabase-rest/` — primary Supabase implementation. Bearer-token HTTPS, no subprocess. **Per codex finding 4: capability-gated by `ValidationPolicy.allowed_actions`, not by a `read_only` flag.** The capability set determines which REST endpoint families are reachable. Calls outside `allowed_actions` are rejected at the call site.
- `src/data-sources/supabase-mcp/` — keeps existing MCP code as an alternative backend. Same interfaces. Off by default in Phase 1.
- `src/data-sources/local-sql-file/` — the `--supabase-schema` path, marked dev-only. Implements `DatabaseMetadataSource` against a local pg_dump file.
- `src/data-sources/lovable-github-clone/` — Phase 1 Lovable read path. Implements `CodeSource`. Explicitly documented as the only Phase 1 Lovable code-read option.
- Future: `firebase-rest/`, `clerk-rest/`, etc. — each is a folder; the registry resolves opaque `DataSourceId`s; no `if (provider === ...)` switches in shared code. Per CLAUDE.md `§Extensibility-first`.

**Per codex finding 5: the CLI's `--dev-*-backend` selector validates against the runtime registry of opaque `DataSourceId`s, not a hardcoded enum.** Customer-facing flag is:

```
pnpm dev -- scan --project <path> --supabase <project_ref>
```

The default backend is `supabase-rest`. Backend override is `--dev-supabase-backend <id>`, hidden behind `VEYRA_DEV=1`.

## Verified Supabase Management REST endpoints (codex Q2 — committed)

This step commits ONLY to documented, stable v1 endpoints:

- `GET /v1/projects/{ref}/database/openapi` — tables (treated as: produces `TableSnapshot[]`; what's exposed and what isn't is bounded by the OpenAPI document).
- `GET /v1/projects/{ref}/storage/buckets` — storage buckets.
- `GET /v1/projects/{ref}/config/storage` — storage configuration.

NOT committed:

- `GET /v1/projects/{ref}/database/context` — deprecated; do not use.
- `POST /v1/projects/{ref}/database/query/read-only` — beta; can read rows if misused; **out of scope for Phase 1**, behind its own capability (`read_database_query_metadata_only`) when revisited. Phase 1 never calls it.

RLS policies: `database/openapi` may NOT expose policy USING/WITH CHECK expressions. If not, `DatabaseMetadataSource.fetchPolicies()` returns a `coverage_gap` with `reason: "Supabase REST does not expose policy expressions via documented endpoints; policy-level findings are not produced by this scan and need human review."` This is honest: REST gives us tables, not necessarily policy bodies. Until Supabase exposes policies via REST, the MCP backend remains the only path for cc-11-6 / cc-11-9 findings.

**Mandatory: this step lands with a contract test that exercises each REST endpoint once against a real Supabase project (env-gated). The recorded response is snapshotted. The test asserts: status 200, shape conforms, no secrets in the response body, `Authorization` header present. Snapshot refreshes when explicit. This catches drift in the recorded contract (parser/shape regressions); live API drift is caught by an opt-in `VEYRA_LIVE_TESTS=1` job that contributors run before releases.**

## CLAUDE.md amendment landed by this step (codex finding 3)

Today CLAUDE.md `§MCP discipline` reads (in part):

> Supabase storage bucket state is not in schema.sql (...). Bucket public/private state comes from MCP (...) only.

This step amends the rule to:

> Storage bucket state comes from a `StorageMetadataSource` (REST or MCP), gated by `ValidationPolicy.allowed_actions.has('read_storage_metadata')`. The schema.sql / pg_dump path still excludes it; the REST path supersedes the "MCP only" wording. Whichever backend is registered, the policy gate is the authority.

This amendment is part of `What lands` and is committed in the same change as the REST backend.

## Done when

A single fresh scan satisfies all of:

1. **REST path proves out end-to-end** against the user's real Supabase sandbox project: `export SUPABASE_ACCESS_TOKEN=... && pnpm dev -- scan --project /tmp/clean --supabase aukqmgjnoldnhrvsolhh --out report.md` exits 0 (or non-zero with `--fail-on-blocker` if findings warrant). The artifact directory contains capability-shaped names (`database-metadata.json`, `storage-metadata.json`, `code-evidence.json`) AND backward-compatibility aliases for `supabase-tables.json` (one Phase 1 release; removed in the next step).
2. **Per-capability outcomes are honest:** tables → `evidence_present` or real findings; policies → either real findings OR a `coverage_gap` with the REST-policy-not-exposed reason (contributor docs cover the dev-only opt-in to alternate backends; report text does not); storage → real findings or REST-error-derived coverage_gap.
3. **No subprocess** is spawned during the default Supabase fetch path. `ps` during a scan shows no `npx`/`node` children spawned by Veyra for Supabase work.
4. **No `supabase` CLI dependency.** Removing the `supabase` binary from PATH does not break the scan.
5. **No `--supabase-mcp` no-op surface.** The flag either runs (via the MCP backend behind the registry) or rejects at parse time with a clear message. It never silently does nothing.
6. **`--lovable-mcp` rejects at parse time** with: `--lovable-mcp requires a Lovable OAuth client; this is deferred to Phase 1 step 28. For Lovable in Phase 1, read code from a local git clone of your Lovable project's GitHub repo.` Customer-facing docs do not list the flag.
7. **`ValidationPolicy.allowed_actions` is the authority.** Every REST call goes through `policy.allowed_actions.has('<action>')` before sending. A test asserts that flipping an action off prevents the corresponding endpoint family from being called. No `if (mode === 'read_only_evidence')` branches anywhere in `src/data-sources/`.
8. **Developer flags are double-gated.** `--dev-supabase-backend supabase-mcp` is rejected unless `VEYRA_DEV=1` is also set. Help text hides `--dev-*` flags by default; `pnpm dev -- scan --help --dev` reveals them.
9. **Capability-shaped artifact names** are written; the transport-shaped names exist only as alias copies that emit a deprecation note in `scan-actions.log`. The next step removes the aliases.
10. **Documented honest limitations.** README + `docs/lovable.md` (or equivalent) explicitly say: "Phase 1 reads Lovable code from a local git clone; Lovable OAuth-based file fetching is deferred to step 28." No marketing language; no "MCP" claim for Lovable.
11. **Contract test in CI.** The REST-endpoint contract test runs as part of `pnpm test`; live invocation is opt-in via `VEYRA_LIVE_TESTS=1 + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF`. Snapshot mode runs always. A missing snapshot fails the test with a clear "run with VEYRA_LIVE_TESTS=1 to record" message.
12. **`pnpm test --run` exits 0** with the new tests; existing 526 tests stay green; step 26's loud-failure mechanism still fires (now tagged to all four schema-driven controls when the chosen backend errors); step 24's MCP wiring path is preserved as the alternative backend.
13. **CLAUDE.md is updated** in the same commit with the storage rule amendment exactly as worded above.

## Out of scope (explicitly NOT done in this step)

- Lovable OAuth client (this is step 28 if pursued; otherwise documented limitation).
- Replacing gitleaks / osv-scanner with HTTP-API equivalents (per codex Q5 — rejected for trust reasons; a follow-up may bundle/cache managed binaries).
- Any hosted product surface (FPP §18 binding).
- Phase 2 PostgREST query-surface checks (cc-11-13a..e) — those remain Phase 2 step 07d work and may legitimately use a different backend.
- Changes to controls catalog, finding shapes, or reporter output.
- Removing the existing MCP code path; it stays as an alternative backend.

## Guardrails

- Per CLAUDE.md `§Extensibility-first`: no closed `'supabase-rest' | 'supabase-mcp' | 'local-file'` discriminator in shared code. Opaque `DataSourceId`; registry-based resolution.
- Per CLAUDE.md `§Secrets`: `SUPABASE_ACCESS_TOKEN` never on argv. Bearer header gets the value at the HTTP boundary; no logging path includes the raw token. Snapshot recording redacts any header/body that could hold it.
- Per CLAUDE.md `§Output language`: coverage_gap summaries use only allowed claims ("the Supabase REST read returned 401 / 403 / 404", "policies not exposed via documented REST endpoint", "needs human review").
- Per CLAUDE.md `§Validation policy`: gates are `allowed_actions`-based, never `read_only`-based. The REST backend MUST NOT carry a `read_only` flag.
- Per `FPP §18 Not Required`: no hosted dashboard, no sign-up flow, no Slack, no PR comments. Customer-experience improvements stay inside the local CLI surface.
- Per CLAUDE.md `§MCP discipline`: any retained MCP path stays under existing `read_only=true + project_ref` policy gate (we are demoting MCP, not loosening it).
- Do NOT delete the existing MCP code. Demote it to alternative backend; existing tests stay green.
- Do NOT widen the REST endpoint surface beyond the three verified endpoints (`database/openapi`, `storage/buckets`, `config/storage`) without a separate planner decision. Beta and deprecated endpoints stay out of scope.
- Do NOT bypass `output-language-lint` on the new strings ("policies not exposed via documented endpoint", "OAuth client required; deferred to step 28").

## References

- The four bad outcomes that motivate this step: (a) `--supabase-mcp` no-op pre-step 24, (b) parse-empty-on-real-dump pre-step 26, (c) MCP Inspector dropping `SUPABASE_ACCESS_TOKEN`, (d) `--lovable-mcp` wired for a token model that doesn't exist.
- Codex review of this step's earlier draft (2026-05-26): six findings, all applied.
- `CLAUDE.md §Resolved engineering decisions` — this step revisits the "Supabase MCP" baseline assumption.
- `CLAUDE.md §MCP discipline` — amended in this step (storage-from-MCP-only wording).
- `CLAUDE.md §Validation policy` — capability-gating is the model; this step enforces it on the REST backend.
- `phases/phase-1/PHASE_1_PLAN.md §4.5` — the section that committed to MCP as the live data path.
- `FPP §18` — Not Required list; remains binding.
- `FPP §2A` — Extensibility-first principle; this step is faithful to it.
- Supabase Management API docs (supabase.com/docs/reference/api) — the new primary backend's contract.
