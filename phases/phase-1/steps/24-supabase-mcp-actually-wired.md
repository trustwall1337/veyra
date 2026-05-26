# Step 24 — Wire the Supabase MCP connector into agent registration so `--supabase-mcp` is not a no-op

**Status:** done (2026-05-25) — wiring shipped end-to-end via injected mock transport; the production transport is split into a follow-up step ([25-supabase-mcp-production-transport.md](./25-supabase-mcp-production-transport.md)) per codex §6.5 finding step24-f1
**Maps to:** none of the planned sections directly — surfaced by the first live `--supabase-mcp` run against a real Supabase project on 2026-05-25. The CLI accepts `--supabase-mcp <project_ref>`, the Supabase MCP connector code exists and has the `read_only=true + project_ref` policy gate, but `src/cli/agent-registration.ts` only registers the `supabase-rls` agent when `--supabase-schema` (local SQL file) is provided. With `--supabase-mcp` alone the agent never registers, no MCP call is ever made, and the flag is effectively decorative.
**Amends Phase 1 step:** none (no contract changes; this fixes a wiring gap that left an entire input mode unused)
**Produces:** code changes in `src/cli/agent-registration.ts` + `src/agents/supabase-rls/` to accept an MCP-driven schema source; new end-to-end test or live-test harness that proves `--supabase-mcp` actually causes a `list_tables` call to land in scan-facts; CLI help-text touch-ups so the flag's behaviour matches its description.
**Depends on:** 16 (Supabase MCP connector + policy gate), 09b (supabase-rls predicate contract), 18b (orchestrator wire-up), 22 (the end-to-end gate that step 24's new assertion lives next to).
**Executed by:** plain coding pass + `mcp-policy-check` subagent (CLAUDE.md §MCP discipline + Lovable+Supabase allowlist) + `step-reviewer` subagent at the end + an end-to-end re-run.
**Verification:** the new end-to-end test runs against a Supabase MCP fixture (recorded or live, see §"Done when") and asserts (a) `supabase-rls` appears in `scan-trace.json`, (b) `supabase-tables.json` is written, (c) `scan-facts.json` contains at least one fact whose `source` indicates an MCP-sourced schema element, (d) the Supabase MCP policy gate still forces `read_only=true` + `project_ref` on every call. Plus `pnpm test --run` stays green across the full suite (currently 492 tests).

## Goal

Make `--supabase-mcp <project_ref>` do what the help text and the customer-facing explanation already promise: drive the `supabase-rls` agent's schema-facts predicates from live MCP calls instead of (or in addition to) a local SQL dump. Right now passing `--supabase-mcp` silently does nothing — the connector is never invoked, the agent never registers, the token never gets touched. The user runs a scan, the scan exits 0, and the report says "supabase-rls may not have produced its output for this scan" while the user wonders why their token wasn't used.

This step fixes that wiring so the flag is functionally wired end-to-end. It is not a feature add — the connector, the policy gate, the agent, and the predicate all exist. They just aren't connected at the registration layer.

## Observed

On 2026-05-25 a live run with `--supabase-mcp aukqmgjnoldnhrvsolhh --mode read_only_evidence --env sandbox` produced:

- `scan-trace.json` listing **6 agents** (product-understanding, tool-runner, authn, authz-tenant, business-logic, evidence-report). The 7th, `supabase-rls`, is **absent** — it was never registered.
- No `supabase-tables.json` artifact.
- `scan-facts.json` content: `{"scan_facts": []}` — empty.
- Report text candidly acknowledging the gap: *"No schema_element table facts were observed in scan-facts.json; supabase-rls (09b) may not have produced its output for this scan."*
- The Supabase access token in the user's shell was never read by Veyra. Zero outbound MCP requests.

Root cause: `src/cli/agent-registration.ts` lines 59–67 register supabase-rls only when `options.supabaseSchemaSqlPath !== undefined`. There is no parallel branch keyed on `options.supabaseMcpProjectRef` (or whatever name carries the `--supabase-mcp` value through `scan-command.ts` into the registration options).

This gap stayed hidden because every test in the fixture suite uses `--supabase-schema` (a bundled local SQL file under `examples/vulnerable-lovable-supabase/supabase/schema.sql`). The MCP path has unit tests at the connector level (mocked transport, allowlist enforcement, redaction) but no end-to-end registration test. Step 22's end-to-end gate exercises the schema-file branch only.

## What lands

Three concrete pieces.

### Piece 1 — Registration branch for the MCP-driven case in `src/cli/agent-registration.ts`

Add an option (e.g. `supabaseMcpProjectRef?: string`) to `RegistrationOptions`, plumbed in from `scan-command.ts`. Add a branch that registers `supabase-rls` when this is set, passing the MCP connector handle to the agent's input builder. The two branches (`supabaseSchemaSqlPath` and `supabaseMcpProjectRef`) are mutually exclusive in this step's scope — if both are passed, default to MCP and emit a one-line uncertainty note so the report is honest about which source was used. Phase 2 may revisit "use both, cross-check" later; that's not this step.

Per CLAUDE.md §Extensibility-first: no `if (source === 'mcp')` switches in shared code. The agent's input builder is the only place that knows whether the connector is file-backed or MCP-backed.

### Piece 2 — Schema-source discriminator inside the `supabase-rls` agent's input shape

Right now the agent input is `{ schemaSqlPath: string, storageBucketsArtifactPath?: string }`. Replace this with a discriminated input that carries either a local file path or an MCP connector handle. The predicate body then asks for tables / policies / bucket-state from whichever source landed.

Per CLAUDE.md §No `any`, §Result<T,E> for expected failures: the MCP source's read methods must return `Result<SchemaSnapshot, ConnectorError>`. Any MCP-side failure (auth, network, rate limit) becomes a `coverage_gap` ScanFact tagged to the controls that supabase-rls would have covered (cc-11-5/6/9/12 + the bits of cc-11-7 the inventory side already covers). The agent does not crash; it surfaces the failure.

### Piece 3 — End-to-end test that proves the MCP path actually fires

`src/cli/end-to-end-fixture.test.ts` (step 22's harness) gets a new test case with a mocked-or-recorded Supabase MCP transport. The test asserts:

1. With `--supabase-mcp <ref>` (and no `--supabase-schema`), `scan-trace.json` includes `agent_id: 'supabase-rls'` with `status: 'ok'`.
2. `supabase-tables.json` is written and contains real (or recorded) table entries.
3. `scan-facts.json` contains at least one fact whose `source.kind` indicates an MCP-sourced schema element.
4. Every recorded MCP request carries `read_only=true` and the `project_ref`. (This restates CLAUDE.md §MCP discipline; restating the rule in the test is the test.)
5. No request is made to `execute_sql` or any other tool outside the Phase 1 Supabase MCP allowlist.

If the project chooses to ship with a recorded MCP fixture (the safer option), the recording lives under `examples/vulnerable-lovable-supabase/mcp-fixtures/supabase-list-tables.json` (the directory already exists per the inventory listing) and the test replays from it deterministically. If a live integration test is desired in addition, it lives under a separate suite that requires the test runner to set `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` env vars — and is skipped (not failed) when those aren't set.

## Done when

A single fresh end-to-end run satisfies all of:

1. **Registration:** `scan-trace.json` for an MCP-driven scan lists `supabase-rls` with `status: 'ok'`. Layer assignment is correct (it runs in layer 0 like the schema-file branch).
2. **Artifact:** `supabase-tables.json` is written to `<artifactDir>/supabase-tables.json` with real entries (table names, RLS state per table, policies with USING/WITH CHECK expressions). Names sourced from the MCP fixture or the live project.
3. **Facts:** `scan-facts.json` contains ≥ 1 entry with `source.scanner_id === 'supabase-mcp'` (or whichever opaque `ScannerId` is canonical for MCP-sourced facts) — naming is per the registry, not hardcoded in tests.
4. **Coverage:** cc-11-5 / cc-11-6 / cc-11-9 / cc-11-12 each have at least one finding (real or `evidence_present`) attributable to MCP facts, not coverage_gap.
5. **Policy gate:** every recorded MCP request carries `read_only=true` AND a `project_ref`. The `mcp-policy-check` subagent passes clean over the diff.
6. **Allowlist:** no MCP call to `execute_sql` or any tool outside the Phase 1 Supabase MCP allowlist. The `mcp-policy-check` subagent confirms.
7. **Conflict handling:** if both `--supabase-schema` and `--supabase-mcp` are provided, the MCP branch wins and the report's "Sources and scanner metadata" section says so explicitly (one line, allowed-claims language).
8. **Regression:** `pnpm test --run` stays green; the existing schema-file branch keeps working unchanged.
9. **Step 23's gates:** all five gates from step 23 still pass on the existing fixture run (no cross-regression).
10. **CLI help text:** the description of `--supabase-mcp` matches reality (drop any forward-looking phrasing). Run through `output-language-lint`.

## Failure modes and what they mean

- **Registration branch added but supabase-rls still doesn't fire.** The orchestrator's topo-sort doesn't see the agent because of a `produces` / dependency mismatch — same shape of bug as step 21's Bug 4. Re-read the `topoLayers` logic before changing it.
- **MCP call lands but `scan-facts.json` stays empty.** The parser between the MCP response and `ScanFact[]` is broken. This is the OSV / Semgrep failure mode from step 23 in a new clothes. Add a parser unit test for the MCP-response → ScanFact mapping.
- **MCP call lands but with `read_only` missing or `false`.** **Stop the step immediately.** This is a CLAUDE.md §MCP discipline violation. The Supabase policy gate must reject the call before it's sent. Find the bypass and close it before any other progress.
- **MCP call lands but the tool name isn't in the Phase 1 allowlist.** Same as above. Stop and audit. The allowlist enforcement lives in `src/core/policy/` per CLAUDE.md; the connector must not bypass it.
- **`coverage_gap` emitted on auth failure but the error message contains the access token.** Redaction broken. Per CLAUDE.md §Secrets the raw token must never reach any artifact. Stop and add redaction at the error-mapping site before continuing.
- **Recorded MCP fixture and live run diverge in shape.** The fixture's response shape lags reality (Supabase added a field). Update the fixture; don't soften the test.

## Guardrails

- Do NOT add any tool to the Phase 1 Supabase MCP allowlist as part of this step. The allowlist is `list_tables`, `get_advisors`, `list_storage_buckets`, `get_storage_config` (per step 16). New tools are out of scope; they require an explicit Phase 2 decision per CLAUDE.md.
- Do NOT call `execute_sql` even under `read_only=true`. It is denied in Phase 1 (CLAUDE.md). The fix here is the agent-registration branch, not new MCP tool surface.
- Do NOT introduce any code path where the access token reaches a log, artifact, AI prompt, error message, or scan-actions.log line in raw form. Redaction is at the connector boundary; this step preserves that.
- Do NOT remove or weaken the schema-file branch (`--supabase-schema`). The two branches coexist; this step adds the MCP one. The fixture suite continues to test the schema-file path.
- Do NOT use the live Supabase MCP endpoint in the default test suite. The default test runs offline against a recorded fixture; a live integration test (if added) is opt-in via env vars and skipped when those env vars are unset.
- Per CLAUDE.md §Extensibility-first: no closed-discriminator unions naming MCP providers in shared types. The `ScannerId` / `ConnectorId` opaque IDs stay in the registry; the agent's schema-source discriminator uses opaque IDs, not literal strings hard-coded in `src/types/` or `src/core/`.
- Per CLAUDE.md §Output language: any new report string ("source: live Supabase MCP", "MCP authentication failed", "policy enforcement blocked the call") goes through `output-language-lint` before commit. No "secure", "safe", "compliant".

## Notes for the implementer

- The Supabase MCP connector under `src/connectors/supabase/` already has the read_only + project_ref policy gate. This step does NOT modify that gate. If the gate appears to reject something it shouldn't, the answer is to investigate the call site, not to relax the gate.
- The supabase-rls agent's predicate body (the part that classifies RLS-off, USING(true), authenticated-without-per-row-check) reads from a typed `SchemaSnapshot`. That type may already be source-agnostic — read it before adding a new one. If it's not, the cleanest fix is to introduce the `SchemaSnapshot` type at the agent boundary so both sources produce the same shape.
- The Supabase access token enters the process via `SUPABASE_ACCESS_TOKEN` (env var). Per CLAUDE.md §Secrets, the env-var name is the contract; the value never appears on argv, never in scan-actions.log, never in any artifact.
- The end-to-end test must run with `pnpm test --run` (not just `pnpm dev -- scan`). Step 22 already proved the schema-file path under `pnpm test`; this step proves the MCP path the same way.

## References

- The empty-MCP run that exposed this: `/tmp/supabase-only-scan/.veyra/scans/2026-05-25T15-51-05-955Z-2c6c6b9b/scan-trace.json` (only 6 agents listed; supabase-rls missing) and `scan-facts.json` (empty).
- The hot path that needs the new branch: `src/cli/agent-registration.ts:59-67`.
- The connector that's wired but unused: `src/connectors/supabase/`.
- The policy gate that must keep enforcing read_only + project_ref: `src/core/policy/`.
- `phases/phase-1/steps/16-connector-supabase-mcp.md` — connector contract (do not change).
- `phases/phase-1/steps/09b-supabase-rls-as-assertion-predicate.md` — agent contract (extend the input shape; do not change the finding output shape).
- `phases/phase-1/steps/22-19b-gate-end-to-end-rewire.md` — end-to-end harness this step extends.
- `examples/vulnerable-lovable-supabase/mcp-fixtures/` — directory already present (per inventory); recorded MCP responses live here.
- `CLAUDE.md §MCP discipline`, §Secrets, §Extensibility-first architecture, §Output language — non-negotiable rules every change in this step must honour.
