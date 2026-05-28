# Step 29 — Close the remaining Phase 1 + Phase 2 gaps so Mode B is actually invokable end-to-end

**Status:** SUPERSEDED (2026-05-27) by the Phase 3 agentic-loop plan (`phases/phase-2-improvement/PLAN.md`). This step was never implemented (was `not started`). Its Mode B CLI wiring is replaced by Phase 3 Step 40 (`Mode B CLI wiring: loop driver + --loop-budget + approval`) + Step 40b (CLI factory/registration migration). Its Phase 1 closeout items are subsumed: `database-metadata` persistence + the `supabase-tables.json` alias are handled by the Phase 3 tool/artifact registration (Step 30/33); the `--lovable-mcp` message becomes moot once Lovable is a tool. One genuinely orphaned item — approval-file **signature verification** (deferred here to a "step 30") — is not addressed by the agentic plan and is recorded as an open item in `phases/phase-2-improvement/decisions.md` for a future phase. The original (not-started) contract is preserved below for the record.

**Original Status (preserved):** not started
**Maps to:** none of the planned sections directly. This is a closeout step that bundles six gaps spread across already-"done" Phase 1 + Phase 2 steps. Today, despite Phase 2 being marked complete across 22 step files, a customer cannot actually run a Mode B active-validation scan against their sandbox Supabase project — the CLI argv parser does not recognise the Mode B flags, `scan-command.ts` always builds a read-only policy regardless of `--mode`, and `runPhase2Scan` is never invoked from the CLI path. Mode B's machinery exists; the customer-facing ignition key and the internal routing both do not.
**Amends Phase 1 step:** 03 (CLI argv — removes Phase 1 read-only-only assumption and any leftover `SANDBOX_REJECTION_MESSAGE` per step 11's deferred follow-up), 27 (closes `database-metadata.json` table-list persistence gap; removes the `supabase-tables.json` compatibility alias as step 27 promised "in the next step"), 28 (updates the `--lovable-mcp` parse-time-reject message to reflect that 28b is paused on the Lovable-side probe).
**Amends Phase 2 step:** 11 (lands the CLI argv-rejection wiring, policy-factory selection, AND the Phase 2 scan-path call site that step 11's status note explicitly deferred — *"the CLI argv-rejection wiring + interactive prompt integration follow in a small follow-up"*).
**Amends CLAUDE.md:** No new amendments.
**Produces:** (a) commander.js option definitions in `src/cli/scan-command.ts` for the Mode B flags; (b) policy-factory selection in `scan-command.ts` so `--mode sandbox_active_validation` produces a sandbox policy, not the default read-only one; (c) scan-path branch that calls `runPhase2Scan` from `src/cli/orchestrator-phase2/runner.ts` when Mode B is selected; (d) removal of Phase 1's leftover `SANDBOX_REJECTION_MESSAGE` parse-time reject; (e) `database-metadata.json` table-list persistence inside `src/agents/supabase-rls/agent.ts` (the file that actually writes the artifact, not the data-source's parser); (f) migration of the only current consumer of the `supabase-tables.json` alias (`src/cli/agent-registration.ts` passing it to authz-tenant) over to `database-metadata.json`, *then* removal of the alias and its deprecation warning; (g) updated `--lovable-mcp` parse-time-reject message to point at "Lovable OAuth client paused on Lovable-side probe — see `phases/phase-1/decisions.md`" instead of the now-stale "deferred to step 28" wording; (h) one end-to-end test that asserts a Mode B argv invocation reaches the sandbox-runner and produces an `active-validation-results.json` artifact.
**Depends on:** 11 (Mode B helpers in `src/cli/mode-b.ts` already exist), 27 (REST backend already returns the table list), 28 (28a's local-git-clone CodeSource already wired). `src/cli/orchestrator-phase2/runner.ts` exists; this step calls it.
**Executed by:** plain coding pass + `step-reviewer` subagent at the end + a real-sandbox Mode B smoke test (env-gated; opt-in).
**Verification:** `pnpm test --run` exits 0 (current baseline 725 stays green; new e2e tests added). A direct CLI invocation `pnpm dev -- scan --project /tmp/clean-empty --mode sandbox_active_validation --env sandbox --supabase-sandbox aukqmgjnoldnhrvsolhh --approve-active --approval-file <path> --test-actor-manifest <path> --out /tmp/active.md` proceeds past argv parsing AND past the policy-factory selection AND reaches `runPhase2Scan` AND invokes the sandbox-runner. With the env vars + real Pro/Business sandbox project + manifest set, an actual IDOR test against `/rest/v1/<table>?id=eq.<other-user-id>` runs and the outcome lands in `active-validation-results.json`.

## What's actually broken today

Codex's review of an earlier draft of this step file surfaced four concrete contract-level issues, all verified against the live repo:

1. **Mode B is not just missing commander options.** `src/cli/scan-command.ts:779` always uses `deps.policyFactory(inputs.env)`, which defaults to a read-only policy regardless of `--mode`. And `runPhase2Scan` at `src/cli/orchestrator-phase2/runner.ts:57` is never called from the CLI path. So even if argv parsing succeeded for Mode B today, the orchestrator would silently run the read-only pipeline.
2. **The flag names I assumed are reversed.** `src/cli/mode-b.ts:8` defines `--approve-active` as a **boolean** gate (the operator's explicit "yes I acknowledge active testing"); `src/cli/mode-b.ts:11` defines `--approval-file <path>` as the signed-file path. Earlier draft had them swapped.
3. **Signature verification is a stub.** `src/cli/scan-command.ts:344` currently passes `skipSignatureVerify: true`. The "approval signature invalid → reject at parse time" gate is not actually implemented; the CLI bypasses verification today. This step's Done-when does not claim signature verification works; it only claims the wiring is in place and the bypass flag is documented as an explicit follow-up.
4. **The artifact-writing site is in the agent, not the data-source.** `database-metadata.json` is written from `src/agents/supabase-rls/agent.ts:907`. The REST path at `agent.ts:596` deliberately discards the table list it just received from `src/data-sources/supabase-rest/database.ts`. The persistence fix targets the agent.

Concrete reproduction (today):

```
$ pnpm dev -- scan --project /tmp/clean-empty --mode sandbox_active_validation --env sandbox \
    --supabase-sandbox aukqmgjnoldnhrvsolhh --approve-active /tmp/approval.json \
    --test-actor-manifest /tmp/actors.yaml
error: unknown option '--supabase-sandbox'
```

## What lands

Six concrete pieces. Listed in priority order. Each one small *individually*; together they are the closeout.

### Piece 1 — Argv wiring + policy selection + Phase 2 scan-path branch (the big one)

`src/cli/scan-command.ts`:

1. Register commander.js options:
   - `--approve-active` — **boolean** gate (matches `src/cli/mode-b.ts:8`).
   - `--approval-file <path>` — path to the signed approval file (matches `mode-b.ts:11`).
   - `--test-actor-manifest <path>` — path to the YAML manifest.
   - `--supabase-sandbox <project_ref>` — the sandbox project's ref. Separate from `--supabase` so Mode A vs Mode B targets stay explicit.
   - `--ci` — non-interactive mode.

2. Policy-factory selection. The current `deps.policyFactory(inputs.env)` call always returns a read-only policy. Replace with `deps.policyFactory({ env: inputs.env, mode: inputs.mode })`. When `inputs.mode === 'sandbox_active_validation'` the factory returns a policy whose `allowed_actions` set includes `synthesize_user`, `sign_in_test_actor`, `read_postgrest_query_surface`, plus the existing read-only set. When `inputs.mode === 'read_only_evidence'` (default), behaviour is unchanged.

3. Scan-path branch. When `inputs.mode === 'sandbox_active_validation'`, the CLI calls `runPhase2Scan` (`src/cli/orchestrator-phase2/runner.ts:57`) instead of the Phase 1 orchestrator. The branch is on `inputs.mode`, not on flag presence — `mode-b.ts` already validates that the right flag combinations accompany the mode.

4. Argv-level rejections (already covered conceptually by `mode-b.ts`; this step wires them through):
   - `--mode sandbox_active_validation` without `--approve-active` → reject at parse time.
   - `--mode sandbox_active_validation` without `--approval-file` → reject (only the signed file path proves operator approval; the boolean gate alone is insufficient).
   - `--mode sandbox_active_validation` without `--supabase-sandbox` → reject.
   - `--env production` + `--mode sandbox_active_validation` → reject (already covered upstream).
   - `--ci` + `--mode sandbox_active_validation` without `--approval-file` → reject.

5. **Signature verification stays stubbed** for this step. `skipSignatureVerify: true` is preserved at `scan-command.ts:344` and a `TODO(step-30): minisign verification` comment is added there pointing at a follow-up step. Done-when explicitly states this; nothing in Done-when claims signature-checking works.

6. **`--supabase-service-role-key` is NOT added to the customer-facing surface in this step** (codex SHOULD-consider #6). Step 29 enables Mode B sub-mode B.1 (manifest mode) only. Passing `--supabase-service-role-key` on argv is rejected with: *"--supabase-service-role-key enables Mode B sub-mode B.2 (auto-synthesize), which is power-user opt-in via env var only. Set `VEYRA_DEV=1` and `SUPABASE_SERVICE_ROLE_KEY=<value>` to enable it. The customer-facing path is manifest mode (sub-mode B.1)."* This honours Phase 2 step 01 preventer decision 10.

### Piece 2 — Remove Phase 1's leftover `SANDBOX_REJECTION_MESSAGE`

Per step 11's status: *"Phase 1 step 03's parse-time SANDBOX_REJECTION_MESSAGE stays in place until that wiring lands."* This step is that wiring landing. Find the constant, confirm it is no longer reachable when `--mode sandbox_active_validation --approve-active --approval-file …` is provided, then remove the dead branch. A regression test confirms.

### Piece 3 — `database-metadata.json` table-list persistence (correct site: `src/agents/supabase-rls/agent.ts`)

Per codex MUST-fix #4: the persistence fix lives in `src/agents/supabase-rls/agent.ts:907` (the artifact writer) and `agent.ts:596` (the REST-path code that currently discards the parsed table list). The fix is twofold:

- `agent.ts:596` stops discarding the REST-returned table list. Tables are passed through into the agent's internal `SchemaSnapshot` with `name`, optional `columns` (whatever shape the REST endpoint exposed), `rls_enabled: null`, `policies: []`.
- `agent.ts:907` writes these entries into `database-metadata.json` as part of the `tables` array.

Critically: **the cc-11-5/6/9/12 predicates that consume this snapshot must not produce false positives when `rls_enabled` is `null` or `policies` is `[]`.** A predicate sees `rls_enabled: null` and treats it as "unknown → coverage_gap" exactly as today; a predicate seeing `rls_enabled: false` would treat it as "likely_issue / launch_blocker." The null vs false distinction is load-bearing.

### Piece 4 — Migrate consumer, then remove `supabase-tables.json` compatibility alias

Per codex MUST-fix #5: `src/cli/agent-registration.ts:191` currently passes `supabase-tables.json` to `authz-tenant`. The alias cannot be removed until that consumer is migrated. Sequence:

1. Add a reader for `database-metadata.json` to `authz-tenant`'s input shape.
2. Update `agent-registration.ts:191` to pass `database-metadata.json`.
3. Run the test suite — all authz-tenant tests still pass (the schema-input contract should be source-of-truth equivalent).
4. Remove the alias write site (the `WARN ... wrote compatibility alias` log line) from wherever it lives (likely `agent.ts:907`).
5. Confirm a scan produces no `supabase-tables.json` and no `WARN` line.

If step 3 fails, the migration is incomplete; do NOT proceed to step 4 in the same commit.

### Piece 5 — Update `--lovable-mcp` parse-time-reject message

Today the message says *"deferred to Phase 1 step 28."* Step 28a is done; 28b is paused on a Lovable-side probe. New message: *"--lovable-mcp requires a Lovable OAuth client. The implementation is paused pending Lovable-side confirmation of OAuth endpoint, DCR support, and authorization scope (see `phases/phase-1/decisions.md` for status). For Lovable in Phase 1, read code from a local git clone — `pnpm dev -- scan --project <path-to-clone>`."*

### Piece 6 — End-to-end test that exercises the Mode B argv path

`src/cli/end-to-end-fixture.test.ts` (or sibling) gets a new test that:
- Constructs a fake approval file + fake manifest in a temp dir.
- Invokes the CLI with the full Mode B argv combination.
- Per Phase 2 step 01 preventer decision 7 (tightened per codex SHOULD-consider #7): the test uses a **recorded-from-real snapshot** for any sandbox / PostgREST transport call OR an env-gated live transport call. Mocks are permitted only for orchestration wrapping (timers, file system, etc.); mocks are NOT permitted for the sandbox-runner's outbound HTTP path.
- Asserts the orchestrator reaches the sandbox-runner agent.
- Asserts `active-validation-results.json` is written to the artifact directory.
- Asserts no `SUPABASE_ACCESS_TOKEN`, `BOB_PWD`, etc. value appears in any artifact, log line, or error message.

## Done when

A single fresh test pass + an env-gated real-DB Mode B smoke run satisfies all of:

1. **All Mode B argv flags are commander.js options.** `pnpm dev -- scan --help` shows `--approve-active`, `--approval-file`, `--test-actor-manifest`, `--supabase-sandbox`, `--ci` under a "Mode B (active validation)" group, with manifest mode (sub-mode B.1) as the documented example.
2. **No `unknown option` error** for any of the above flags.
3. **`scan-command.ts:779`'s policy-factory call uses both `env` and `mode`**, and a unit test asserts that `mode: sandbox_active_validation` produces a policy whose `allowed_actions` set includes the active-validation actions.
4. **`runPhase2Scan` is invoked** when `inputs.mode === 'sandbox_active_validation'`. A unit test stubs `runPhase2Scan` and asserts it gets called with the expected inputs.
5. **Phase 1 `SANDBOX_REJECTION_MESSAGE`** is removed from source. A grep returns zero hits in `src/`.
6. **`database-metadata.json` contains discovered table names** when the REST backend finds them, with `rls_enabled: null` and `policies: []` when the REST endpoint did not expose those.
7. **No false positive on null RLS state.** A new test feeds the predicate a `SchemaSnapshot` where every table has `rls_enabled: null` and asserts that cc-11-5/6/9/12 produce `coverage_gap`, NOT `likely_issue` or `launch_blocker`.
8. **`supabase-tables.json` alias is gone.** A scan produces no such file; the `WARN ... compatibility alias` log line is no longer emitted. The authz-tenant agent reads from `database-metadata.json`.
9. **`--lovable-mcp` parse-time-reject message** matches Piece 5; an existing assertion is updated.
10. **End-to-end Mode B argv test passes** under `pnpm test`, with recorded-from-real or env-gated-live transport — never mock-only.
11. **`--supabase-service-role-key` rejection message** matches Piece 1.6.
12. **`pnpm test --run` exits 0.** Current baseline 725 tests stay green; new tests added bring the total to ≥730.
13. **Live smoke (env-gated, opt-in)** — with `SUPABASE_ACCESS_TOKEN` + `BOB_PWD` + a real sandbox manifest, the full Mode B command against the user's real sandbox project produces an `active-validation-results.json` with at least one IDOR test recorded as `proven_allowed`, `proven_denial`, or `inconclusive`. This is the moment-of-truth gate for the entire Mode B story; do not skip it.
14. **Signature verification stays stubbed** with a `TODO(step-30)` pointer; explicit follow-up step file land for it. Step 29 does not claim signature checks work.

## Out of scope

- **Step 28b (Lovable OAuth)** — paused on Lovable-side probe. This step does NOT unblock it; it only updates the deprecation message to match reality.
- **Real minisign / cosign signature verification of `--approval-file`.** Documented as the next follow-up step (call it 30); step 29 lands the wiring with the bypass flag explicitly noted.
- **Mode B sub-mode B.2 (auto-synthesize via service-role key)** — explicitly out per Piece 1.6.
- New Mode B features beyond what step 11 already shipped (custom test types, AI-planner extensions, additional approval-file formats).
- Phase 3 work.

## Guardrails

- Per CLAUDE.md `§Secrets`: passwords, refresh tokens, JWTs, service-role keys never on argv. Manifest declares `password_env: ALICE_PWD`; password read from `process.env[ALICE_PWD]`. `--supabase-service-role-key` is rejected on argv per Piece 1.6.
- Per CLAUDE.md `§Output language`: every new string ("--mode sandbox_active_validation requires --approval-file", "auto-synthesize requires VEYRA_DEV=1", "Lovable OAuth paused on Lovable-side probe") goes through `output-language-lint`.
- Per CLAUDE.md `§Extensibility-first`: no closed `'b1' | 'b2'` discriminator added to shared types. The sub-mode is resolved at the `mode-b.ts` boundary.
- Per CLAUDE.md `§Validation policy`: capability-gated by `ValidationPolicy.allowed_actions`. Piece 1.2 extends the active-set; it does not collapse modes into one.
- Per Phase 2 step 01 preventer decision 7 (tightened per codex SHOULD-consider #7): the end-to-end test that exercises Mode B's argv path uses recorded-from-real or env-gated live transport for the sandbox / PostgREST path. Mocks are limited to orchestration wrapping. Mock-only verification of those paths is forbidden.
- Per Phase 2 step 01 preventer decision 9: Mode B's test universe is the bundled catalog; this step does not add custom test surfaces.
- Per Phase 2 step 01 preventer decision 10: documented Mode B example leads with manifest mode (B.1).
- Do NOT implement real signature verification in this step. That is step 30.
- Do NOT remove the `supabase-tables.json` alias before the authz-tenant migration lands and the test suite is green.
- Do NOT change Mode B helpers in `src/cli/mode-b.ts`. This step wires existing helpers; it does not redesign them.

## References

- `src/cli/mode-b.ts:8` (`--approve-active` boolean), `:11` (`--approval-file <path>`).
- `src/cli/scan-command.ts:344` (signature-verification bypass — preserved by Piece 1.5; step 30 territory).
- `src/cli/scan-command.ts:779` (policy-factory call site fixed by Piece 1.2).
- `src/cli/orchestrator-phase2/runner.ts:57` (the `runPhase2Scan` Piece 1.3 wires).
- `src/cli/agent-registration.ts:191` (the alias consumer migrated by Piece 4).
- `src/agents/supabase-rls/agent.ts:596` (REST-table-discard fixed by Piece 3) and `:907` (artifact writer extended).
- `phases/phase-2/steps/11-cli-mode-b-and-approval-flow.md` — the step whose deferred follow-up this closes.
- `phases/phase-1/steps/27-architectural-course-correction-rest-and-honest-paths.md` — committed to alias removal in "the next step" (Piece 4) and table-list persistence (Piece 3).
- `phases/phase-1/steps/28-lovable-oauth-client-and-codesource.md` — message wording updated by Piece 5.
- `CLAUDE.md §Secrets`, `§Output language`, `§Validation policy`, `§Extensibility-first` — non-negotiable rules every Piece honors.
- `phases/phase-2/steps/01-lock-phase2-blocking-decisions.md` — preventer decisions 7, 9, 10 bind the test discipline and documentation defaults landed by Piece 6.
- Codex first-review findings on this step file (2026-05-26): 5 MUST-fix + 2 SHOULD-consider; all applied in this revision.
