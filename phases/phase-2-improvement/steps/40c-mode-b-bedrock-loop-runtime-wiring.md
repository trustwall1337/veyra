# Step 40c-v3 — Mode B on the Bedrock agentic loop: write-capable runtime wiring (auth-session shape pinned)

**Status:** done (2026-05-29) — Mode B Bedrock loop runtime wiring landed: ProbeResponseSource variant + round-trip bridge + runtime probe-primitives catalog (foundation pass); ActorSecretRegistry; supabase-auth connector promoted from inline; WriteRegistry G.5 extension (GET + cleanup_strategy); Admin signOut surface; synthesize-actor + establish-actor-session + probe-http tool descriptors; registerActiveValidationTools; floor predicate entry for active-validation outcomes; runBedrockLoopBranchModeB with try/finally cleanup (signOut → deleteUser LIFO via WriteRegistry.reverseWalk); ValidatedScanInputs fields; commander Mode B options (approve-active + supabase-sandbox + supabase-service-role-key + supabase-anon-key + ci + approval-file); ActorSecretRegistry.clearAll() in finally; cleanup-proof.json persisted; http-write-registry.json persisted; cleanupFailedFinding when residual_count > 0; active-outcomes report section. Codex v2 + v3 + diff review rounds all applied (10 + 3 + 4 = 17 findings dispositioned). Verification: pnpm typecheck clean; pnpm test 889 passed / 2 skipped / 0 failed. Live smoke V3 (operator-run against real Supabase sandbox) pending operator's env (AWS_PROFILE=preprod + VEYRA_TEST_SRK + VEYRA_SUPABASE_ANON_KEY + --supabase-sandbox <ref>).

**Supersedes:** 40c-v2 (codex round 1, 10 MUST-FIX). All MUST-FIX + SHOULD-CONSIDER + drift items from v1+v2 remain applied. v3 adds Decision G (the auth-session shape) and the §5 substep design v2 left underspecified.

**Maps to:** `phases/phase-2-improvement/PLAN.md` §B (loop is the orchestrator), §D.1 (result-parse-or-reject), §D.2 (floor is sole `Finding` constructor — import-graph guard), §D.3 (unified write registry — BOTH paths, cleanup mandatory), §E (budget caps incl. writes), §G (Mode B trust-mode matrix), §H Cut 3 (Steps 38/39/40), §K (Mode B ledger rows); `phases/phase-2-improvement/decisions.md` D1 / D2 / D3 / D4; closes the explicit deferral in `phases/phase-2-improvement/steps/40-mode-b-cli-wiring.md` AND replaces the Cut-3 reject at `src/cli/scan-command.ts:1051-1063` with a real Mode B route on the Bedrock loop path. Parallels Step 31d (Mode A on the same path).

**Phase:** 3, Cut 3.

## Adjacent step dependency surfaced by v3

v3 requires Mode B to carry a Supabase **anon key** (NOT a secret per Supabase docs, but distinct from the service-role key). Option B sign-in needs an anon-key-scoped `createClient(url, anonKey)`. The flag is `--supabase-anon-key <ENV_VAR_NAME>` — env-var NAME on argv, value in env, symmetric with `--supabase-service-role-key`. **This flag is an addendum to Step 40 (Mode B CLI wiring), NOT to this step.** 40c-v3 declares the dependency; Step 40 adds the parser entry. One option in the argv table + one field on `ValidatedScanInputs`.

## Foundation already landed (do NOT rebuild)

- `src/types/scan-fact.ts` — `ProbeResponseSource` variant + `ProbeResponsePayload` (foundation pass).
- `src/scanners/scan-fact-tool-result.ts` — `probe_response` emit case (foundation pass).
- `src/core/orchestrator/named-fact-to-scan-fact.ts` — `probe_response` decode case (foundation pass).
- `src/agents/sandbox-runner/probe-primitives.ts` — runtime catalog with cc-11-3 IDOR (foundation pass).

## Pivotal decisions taken (v3)

v2's Decisions A–F preserved verbatim:

- **Decision A (MF-2): REUSE existing `AllowedAction` values** `'call_api_with_test_identity'` (probe-http) and `'create_synthetic_user'` (synthesize-actor, establish-actor-session).
- **Decision B (MF-6): NEW `establish-actor-session` tool** (separate from `synthesize-actor`).
- **Decision C (MF-8): cc-11-3 ONLY at runtime in this step.** Lifted into `probe-primitives.ts` (LANDED).
- **Decision D (MF-9): new "Active validation outcomes" report section + Findings only for launch-blocker cases.**
- **Decision E (MF-5): Finding import-graph guard** — descriptors and their helpers never reach `Finding`.
- **Decision F (MF-3): `WriteRegistry` + transports flow through CLOSURE, not `ToolContext`.**

NEW in v3:

- **Decision G (auth-session shape): Option B — `signInWithPassword` via a promoted `supabase-auth` connector + in-process `ActorSecretRegistry`.**
  - Runner-up: Option A (`auth.admin.generateLink({type: 'magiclink'})` + `verifyOtp`).
  - Tradeoff: Option B reuses the proven `AuthSignInClient` shape currently inlined at `src/agents/test-actor-manifest-reader/agent.ts:62-81` and produces a real long-lived user-context JWT identical to what a real attacker logging in as user B would send. Option A's magiclink JWT is a single-use OTP requiring a follow-up `verifyOtp` and inconsistent SDK behaviour across versions — fragility for no security gain. `AdminSdkLike` is NOT extended for sign-in.

- **Decision G.1: JWT lives in an in-process `ActorSecretRegistry`, closure-only, wiped in `finally`.** Runner-up: `ToolContext` field. Tradeoff: `ToolContext` F3 stability at `descriptor.ts:24-29` (MF-3 unchanged).

- **Decision G.2: `actor-sessions.json` carries `{actor_id, role, session_token_digest: sha256(jwt), established_at, expires_at?}` — DIGEST ONLY, never raw JWT.** Runner-up: embed JWT for replay convenience. Tradeoff: CLAUDE.md §Secrets is absolute.

- **Decision G.3: passwords generated in-process by `synthesize-actor`, held only in `ActorSecretRegistry`, NEVER persisted in any form (not even digested), wiped in `finally`.** Runner-up: persist a `password_handle_digest` for audit. Tradeoff: SRK already authorizes recreation; digest adds no audit value and one more secret-shaped string on disk.

- **Decision G.4 (v3 codex round 2 MF-1 clarification): server-side session cleanup uses BOTH the actor UID AND the JWT pulled from `ActorSecretRegistry` at cleanup time.** The cleanup-closure resolves the actor's JWT from the registry (still alive at `finally` time because `clearAll()` runs LAST), then calls the admin-connector wrapper which internally invokes the SDK's signout primitive (typically `auth.signOut(jwt)` or `auth.admin.signOut(uid)` depending on which surface Supabase exposes — the wrapper picks the right one at SDK install time). `WriteEntry.description_redacted` records only `{actor_id, session_token_digest}` — never raw JWT. Runner-up: leave to natural expiry. Tradeoff: revoking a synth session is security-meaningful; aligns with §D.3. Requires extending `AdminSdkLike` with a narrow `signOutUser({uid, jwt})` surface — small narrow SDK-surface addition (NOT a closed-union violation).

- **Decision G.5: `HttpWriteRequest.method` extended to include `'GET'` for probe-audit-only entries.** `WriteEntry` gains `cleanup_strategy: 'audit_only' | 'reverse'`; reverse-walk no-ops on `audit_only`. Runner-up: parallel audit mechanism. Tradeoff: one new literal + one new field beats two write-recording paths.

## Produces

- **`src/connectors/supabase/auth/client.ts` (NEW — Decision G).** Promotes the `AuthSignInClient` shape from `src/agents/test-actor-manifest-reader/agent.ts:62-81` into a shared connector. Exports `SupabaseAuthClient` + `createSupabaseAuthClient({apiUrl, anonKey, sdkClient?})`. Surface: `signInWithPassword({email, password}) → Result<{access_token, refresh_token?, expires_at?, user: {id}}, Error>`. `test-actor-manifest-reader` rewires to consume it (no behavioural change there).

- **`src/core/sandbox/actor-secret-registry.ts` (NEW — Decision G.1 + G.3).** Closure-only registry holding `{actor_id → {email, password, access_token?}}`. Lives the lifetime of one Mode B loop run; `clearAll()` runs in `try/finally`. No persistence. Mirrors `WriteRegistry` ownership.

- **`src/cli/tool-registration.ts` — new exported `registerActiveValidationTools(registry, options)`.** Options now: `{writeRegistry, adminClient, supabaseAuthClient, actorSecretRegistry, httpTransportFactory, envReader, serviceRoleEnvVarName, anonKeyEnvVarName}`. Closure-passed; `ToolContext` UNCHANGED.

- **`src/connectors/supabase/admin-tools/synthesize-actor/tool.ts` (NEW).** B.2 auto-synthesize. `required_action: 'create_synthetic_user'`. Internally generates a random password (`crypto.randomBytes(32).toString('base64url')`), passes to `SupabaseAdminClient.createSyntheticUser({password, ...})` (existing surface at `client.ts:126-131` already accepts `password`). Writes `{actor_id, email, password}` to `ActorSecretRegistry`. Records Path-2 admin WriteEntry (`cleanup_strategy: 'reverse'`) so cleanup deletes the user. Result-schema facts the AI sees: ONLY `actor_handle_digest, role, tenant_id?` — never email, never password. Finding-free `sdk-helper.ts` per v2.

- **`src/connectors/supabase/admin-tools/establish-actor-session/tool.ts` (NEW).** Decision B + Decision G. Args: `{actor_id}`. Reads `{email, password}` from `ActorSecretRegistry`; calls `supabaseAuthClient.signInWithPassword({email, password})`; stores `access_token` back into the registry. Persists `actor-sessions.json` with `{actor_id, role, session_token_digest: sha256(jwt), established_at, expires_at?}` — DIGEST ONLY (Decision G.2). Records Path-2 admin WriteEntry for the session (`cleanup_strategy: 'reverse'`); cleanup calls `admin.signOut(actor_id)`. Result-schema facts the AI sees: `actor_id, role, session_token_digest, established_at` — never raw JWT.

- **`src/scanners/probe-http/tool.ts` (NEW).** `required_action: 'call_api_with_test_identity'`. Args include `{actor_id, probe_id, ai_authored_fields}`. Looks up `args.actor_id` in `ActorSecretRegistry`, retrieves JWT, attaches `Authorization: Bearer <jwt>` to the compiled request. Records audit-only WriteEntry (`cleanup_strategy: 'audit_only'`, method `'GET'` permitted — Decision G.5). **The `invoke` function ALSO calls `state.recordProbeAttempt()` BEFORE send (v3 codex round 2 MF-2)** so `ArtifactState.probeAttemptCount() >= 1` and the ledger predicate `declared_probe_attempted` (`required-evidence-ledger.ts:111`) fires; the WriteEntry alone is necessary (cleanup audit) but NOT sufficient (ledger). JWT never appears in `args_redacted` (the AI's argv key is `actor_id`, not the JWT). Result-schema: whitelist-only `ProbeResponseFacts` per v2.

- **`src/connectors/supabase/admin/client.ts` amendment — Decision G.4.** Extend `AdminSdkLike.auth.admin` with `signOut(uid: string): Promise<{data: unknown, error: {status, message} | null}>`. Extend `SupabaseAdminClient` interface with `signOutUser(uid): Promise<Result<void, Error>>`. Cleanup reverse-walk calls `signOutUser` before `deleteUser` (LIFO already enforces this when entries are recorded in synthesize→session order).

- **`src/core/sandbox/http-write-registry.ts` amendment — Decision G.5.** `HttpWriteRequest.method` union extended with `'GET'`. `WriteEntry` gains `cleanup_strategy: 'audit_only' | 'reverse'` (default `'reverse'`). `reverseWalk` no-ops on `audit_only` entries; cleanup-proof reports them under `attempted` + `succeeded` as no-op successes. New `assertExhaustiveCleanupStrategy` helper keeps future extensions honest.

- **`src/cli/floor-predicates.ts` amendment.** New entry `{ predicate_id: 'active-validation-probe-outcomes', control_ids: ['cc-11-3'], run: probeOutcomeFindings }`. `probeOutcomeFindings(facts)` filters `ScanFact`s with `source.kind === 'probe_response'`, builds `ProbeObservation`s from `source.payload`, calls `classifyProbe(...)` + `findingForOutcome(...)`. Decision D — findings only for launch-blocker cases.

- **`src/cli/scan-command.ts` runtime routing.** Cut-3 reject at `:1051-1063` REPLACED with `runBedrockLoopBranchModeB(...)`:
  - **Adds `supabaseSandboxProjectRef?: string` + `supabaseServiceRoleEnvVarName?: string` + `supabaseAnonKeyEnvVarName?: string` to `ValidatedScanInputs` (MF-1 + v3 anon-key).** Copies from `ScanOptions` at the `validated:` assignment site, populated only when Mode B is selected.
  - Reuses existing Mode B parse gates (`validateScanOptions` at `:302-366`).
  - **REUSES** `defaultSandboxActiveValidationPolicy(env)` at `validation-policy.ts:103` — v2's new `defaultActiveValidationPolicy` factory DROPPED.
  - Moves B.2 service-role-env-var-name + anon-key-env-var-name presence checks into the `registerActiveValidationTools` closure (v2 SHOULD-CONSIDER #2).
  - Constructs `ActorSecretRegistry` + `WriteRegistry` + `supabaseAuthClient` (anon-key) + `supabaseAdminClient` (SRK).
  - Builds driver via `constructLoopDriver({providerId: 'bedrock', ...})`.
  - `ToolContext` = `{scanId, projectPath, artifactDir}` UNCHANGED.
  - **Wraps loop in `try / finally` (MF-4).** `finally` runs cleanup reverse-walk over BOTH paths, persists `CleanupProof`, appends `cleanupFailedFinding` if residuals, AND wipes `ActorSecretRegistry.clearAll()`. Wipe failure is logged but does not block report render.
  - Bridges to markdown reporter with a new `active_outcomes: ActiveOutcomeRow[]` input (Decision D).

- **`src/reporters/markdown/agentic-report.ts` amendment — Decision D.** New input `active_outcomes?: readonly ActiveOutcomeRow[]` where `ActiveOutcomeRow = {probe_id; control_id; outcome: 'proven_denial'|'proven_allowed'|'inconclusive'; expectation: 'expect_denial'|'expect_allow'}`. When non-empty, renders a `## Active validation outcomes` section with allowed-claim vocab. Existing trace counts at `:125-135` stay.

- **Test helper `src/cli/__tests__/helpers/assert-no-secrets-in-artifacts.ts` (NEW — SHOULD-CONSIDER #1, extended).** Generic `assertNoSecretsInArtifacts(seedValues[], dir)` covering SRK + JWT. NOT production code. V5 + V18 import it.

- **`examples/vulnerable-lovable-supabase/recordings/mode-b-cc-11-3/` (NEW — SHOULD-CONSIDER #3, extended).** Recorded Bedrock + PostgREST + Admin SDK + **Auth SDK** responses for the cc-11-3 happy path. V3b replays.

## Depends on

31 (loop), 31b (Bedrock provider + recorded transport), 31d (Mode A live + `constructLoopDriver` + `--loop-budget` + raw-argv guard), 33 (read-only registry), 35b (floor predicate registry + bridge round-trip), 38 (`WriteRegistry` + cleanup reverse-walk), 39 (probe substrate), 40 (Mode B argv parser + gates — **plus the `--supabase-anon-key <ENV_VAR_NAME>` addendum noted above**), 40b (factory + registration migration).

## Executed by

Plain coding pass + `mcp-policy-check` skill (V9, V10) + `output-language-lint` skill (V6 + V6b) + `plan-adherence` skill against PLAN §D.1/§D.2/§D.3/§G/§K + `step-reviewer` + one codex single-review round at §6.5 + deterministic recorded fixture run in CI (V3b) + one operator-run live smoke (V3 supplemental).

## Verification

`pnpm test --run` green; `pnpm typecheck` green; lint NOT gating (pre-existing failures per task #4). V1–V17 from v2 preserved verbatim with these clarifications:

- **V3** live smoke now exports `VEYRA_TEST_SRK` + `VEYRA_SUPABASE_ANON_KEY`, asserts the chain: `synthesize-actor` → `establish-actor-session` → `probe-http: cc-11-3-direct-object-access` → cleanup reverse-walks signOut(s) before deleteUser(s).
- **V3b** recorded fixture extended to inject fake `supabaseAuthClient` returning a deterministic fake JWT (e.g. `fake-jwt-aabbccdd-1111-2222-3333-deadbeefcafe`).
- **V5** SRK walker extended to also walk for the fake JWT.
- **V8** (no write descriptor escapes Mode A): extended to assert all three new descriptors absent from `registerReadOnlyTools(...)`.
- **V13** (Floor-only Finding construction): extended import-graph walk to cover `supabase-auth` connector + `actor-secret-registry`. Neither may reach `Finding`.
- **V15** unchanged (`mode_a + mode_b_add = 6 + 2 = 8`).

NEW:

- **V18. Raw JWT never persists.** Seed `supabaseAuthClient` stub to return `access_token: 'fake-jwt-aabbccdd-1111-2222-3333-deadbeefcafe'`. Run V3b's chain. Walk:
  - every file under `<artifactDir>/` — assert NONE contains the fake-JWT substring.
  - `loop-trace.jsonl` — assert NO row's `args_redacted` or `result_redacted` contains the fake-JWT substring.
  - `actor-sessions.json` — assert it contains the SHA-256 digest of the fake JWT, NOT the JWT itself.

- **V19. Cleanup signs out before deleting (Decision G.4).** Assert the recorded cleanup reverse-walk shows `signOut(actor_id_X)` BEFORE `deleteUser(actor_id_X)` for each actor.

- **V20. Audit-only WriteEntry no-ops on reverse-walk (Decision G.5).** Stub `probe-http` to record one audit-only WriteEntry. Assert `reverseWalk()` returns `attempted: 1, succeeded: 1, failures: []`; the HTTP cleanup executor for `audit_only` is NEVER invoked.

- **V21. `ActorSecretRegistry` wiped on success AND on loop crash.** (a) successful run → `clearAll()` called, registry empty post-finally. (b) loop crash mid-probe → `clearAll()` still called.

## Goal

Make a real Mode B scan invokable end-to-end against a Supabase sandbox project the operator owns. After this step a user who has ONLY a Supabase dev project + a service-role key + the project's anon key (no local code clone) can run `pnpm dev -- scan --project /tmp/veyra-supabase-only-stub --ai-provider bedrock --mode sandbox_active_validation ...` and Veyra:
- synthesizes an actor through the Admin SDK with an in-process-generated password held only in `ActorSecretRegistry`,
- signs that actor in via the **anon-key-scoped** Supabase Auth client (`signInWithPassword`),
- writes `actor-sessions.json` with `{actor_id, role, session_token_digest}` (digest only, never raw JWT),
- has the AI driver propose an IDOR probe within the Step 39 `requestSchema`,
- compiles the proposed request, attaches `Authorization: Bearer <jwt>` from the registry, executes through `executeWriteWithRegistry()` (audit-only entry, GET method),
- schema-parses the response into `ProbeResponseFacts`,
- runs the deterministic outcome classifier in the floor → emits per-probe Finding only for launch-blocker cases (Decision D),
- reverse-walks: signOut(actor) → deleteUser(actor); `residual_count: 0` — on success OR on a loop crash; `ActorSecretRegistry` wiped.

## What lands

- New connector `src/connectors/supabase/auth/client.ts` (Decision G).
- New `src/core/sandbox/actor-secret-registry.ts` (Decision G.1 + G.3).
- Surface additions to `src/connectors/supabase/admin/client.ts`: `signOut` on `AdminSdkLike` + `signOutUser` on `SupabaseAdminClient` (Decision G.4).
- Surface additions to `src/core/sandbox/http-write-registry.ts`: `'GET'` in `HttpWriteRequest.method`; `cleanup_strategy` on `WriteEntry` (Decision G.5).
- New `registerActiveValidationTools(...)` in `src/cli/tool-registration.ts`.
- New leaf folder + descriptor `src/connectors/supabase/admin-tools/synthesize-actor/tool.ts` + Finding-free `sdk-helper.ts`.
- New leaf folder + descriptor `src/connectors/supabase/admin-tools/establish-actor-session/tool.ts`.
- New leaf folder + descriptor `src/scanners/probe-http/tool.ts`.
- New registry entry in `src/cli/floor-predicates.ts`.
- New branch arm in `src/cli/scan-command.ts` replacing the Cut-3 reject: `runBedrockLoopBranchModeB(...)` with `try/finally` cleanup + `ActorSecretRegistry.clearAll()`.
- Renderer extension in `src/reporters/markdown/agentic-report.ts`.
- Extended test helper `src/cli/__tests__/helpers/assert-no-secrets-in-artifacts.ts`.
- New recorded fixture under `examples/vulnerable-lovable-supabase/recordings/mode-b-cc-11-3/` extended for the auth-signin response.
- Refactor: `src/agents/test-actor-manifest-reader/agent.ts` rewires to consume the new shared `supabase-auth` connector. Behaviour preserved.
- **NO** new ArtifactKind. **NO** new policy mode. **NO** new CLI flag IN THIS STEP (the `--supabase-anon-key` flag is added in Step 40's addendum). **NO** `AllowedAction` union edit (Decision A).
- **NO** new policy factory (v2's `defaultActiveValidationPolicy` DROPPED — `defaultSandboxActiveValidationPolicy` is sufficient).
- **Foundation pieces from v2's §5 attempt are PRESERVED** (`ProbeResponseSource`, emit/decode round-trip, `probe-primitives.ts` runtime catalog).

## Done when

All V1–V17 from v2 pass AND V18–V21 pass. With `AWS_PROFILE=preprod`, `AWS_REGION=eu-west-1`, `VEYRA_TEST_SRK=<service-role-key>`, and `VEYRA_SUPABASE_ANON_KEY=<anon-key>` exported:

```
pnpm dev -- scan \
  --project /tmp/veyra-supabase-only-stub \
  --ai-provider bedrock \
  --ai-model eu.anthropic.claude-sonnet-4-5-20250929-v1:0 \
  --mode sandbox_active_validation \
  --env dev \
  --approve-active \
  --supabase-sandbox <project_ref> \
  --supabase-service-role-key VEYRA_TEST_SRK \
  --supabase-anon-key VEYRA_SUPABASE_ANON_KEY \
  --out veyra-report.md
```

produces:
- (a) `<projectRoot>/.veyra/scans/<id>/loop-trace.jsonl` containing the loop-phase rows: synthesize → session → probe → allow → accepted (each carrying `model_id`); cleanup actions (signOut, deleteUser) are NOT loop-trace rows (no such `LoopRecordKind`) — they are recorded in the persistent cleanup-proof audit trail per (c) below. NO loop-trace row contains the raw JWT or the SRK value. (v3 codex round 2 SC-1 clarification.)
- (b) `<artifactDir>/actor-sessions.json` with `{actor_id, role, session_token_digest, established_at, expires_at?}` rows (never raw JWT).
- (c) `<artifactDir>/http-write-registry.json` + `<artifactDir>/cleanup-proof.json`: the first contains at least one audit-only GET entry + admin synthesize + admin session entries; the second contains the reverse-walk attempts (signOut → deleteUser per actor, in that LIFO order). Cleanup actions visible HERE, not in `loop-trace.jsonl`.
- (d) `veyra-report.md` with an "Active validation outcomes" section enumerating at least one cc-11-3 outcome row.
- (e) `CleanupProof.residual_count === 0`.
- (f) ZERO occurrences of either the service-role-key value or the raw JWT value across all artifacts and the loop trace.

The `--no-ai` baseline scan remains byte-identical (regression vs Step 35b V3). V3b deterministic fixture passes byte-identically across two consecutive CI runs **AFTER normalizing wall-clock `recorded_at` out of every JSONL row** (v3 codex round 2 MF-3 clarification — V3b's own normalizer is the comparison contract; a deterministic-clock injection is a future-cleaner approach but is out of scope here).

## SHOULD-CONSIDER disposition

- **#1 (`assertNoServiceRoleValueInArtifacts` helper):** ACCEPTED + extended — now generic `assertNoSecretsInArtifacts(seedValues[], dir)` covering SRK + JWT.
- **#2 (action-registry abstraction soon):** Deferred (closed `AllowedAction` union unchanged, Decision A).
- **#3 (deterministic recorded Mode B fixture in CI):** ACCEPTED + extended to cover the auth-signin response.
- **#4 (NEW v3): `--supabase-anon-key` flag belongs in Step 40, not here.** Step 40 addendum tracked.

## Guardrails

- **CLAUDE.md §Secrets:** SRK env-only; anon-key env-only; JWT in-memory only via `ActorSecretRegistry`; password in-memory only; only DIGESTS on disk. V18 enforces.
- **CLAUDE.md §Validation policy:** `--env production` + Mode B → reject at THREE independent layers (V1). Gate authorizes by `allowed_actions`, never by `mode` (V7). REUSES `SANDBOX_ALLOWED_ACTIONS` (Decision A) — closed union unchanged.
- **CLAUDE.md §MCP discipline:** Mode B writes via PostgREST + Admin SDK + the new Auth SDK (anon-key-scoped) — NOT MCP. Lovable allowlist + Supabase `read_only=true` + `project_ref` + no `execute_sql` invariants green (V9, V10).
- **CLAUDE.md §Output language:** "Active validation outcomes" section uses allowed-claim vocab only (V6 + V6b).
- **PLAN §D.1:** every probe-http result schema-parses before persist or floor (V12).
- **PLAN §D.2:** new predicate calls `classifyProbe` in the floor. Import-graph guard extended to cover `supabase-auth` connector + `actor-secret-registry` (V13).
- **PLAN §D.3:** writes route through `executeWriteWithRegistry()` (HTTP, incl. audit-only GET — Decision G.5) + `recordAdminWrite()` (Admin SDK, incl. signOut — Decision G.4). Cleanup reverse-walks both. Cleanup failure → launch-blocker (V4). Cleanup runs on success AND on loop crash via try/finally (V4b). `ActorSecretRegistry` wiped under same try/finally (V21).
- **PLAN §E:** writes count against budget caps (V11).
- **PLAN §K:** ledger ids `establishActorSession` and `actorSessions` satisfied verbatim. `ACTIVE_PROBE_ACTIONS` pulls Mode-B rows via `allowed_actions`, never via `policy.mode` (V15).
- **FPP §2A:** ZERO new closed-union members. New descriptors + new connector in leaf folders; no `switch (service_id)`. `HttpWriteRequest.method` and `WriteEntry.cleanup_strategy` are intentional union extensions on internal shared types — every consumer's switch must extend (compile-time enforced; this step adds `assertExhaustiveCleanupStrategy`).
- **Scope discipline:** no dashboard, no Slack, no PR comment, no autonomous remediation, no compliance claim. JSON on agentic path deferred (Cut 2). Approval-file signature verification deferred (orphaned item). The 12 remaining `CatalogEntry`s stay on the topo path (Step 39b).
- **Phase 2 step 01 preventer 7:** Bedrock recorded-fixture by default; `VEYRA_BEDROCK_LIVE=1` gates live.

## References

(v2 references preserved; additions for v3 Decision G:)

- `src/agents/test-actor-manifest-reader/agent.ts:62-81` — `AuthSignInClient` shape that Decision G promotes.
- `src/agents/test-actor-manifest-reader/agent.ts:134-172` — JWT-in-memory pattern Decision G.1 reuses.
- `src/connectors/supabase/admin/client.ts:88-90` — `AdminSdkLike.createUser({password})` already accepts password.
- `src/connectors/supabase/admin/client.ts:97-103` — `deleteUser` surface (cleanup reverse-walk reuses).
- `phases/phase-2-improvement/steps/40-mode-b-cli-wiring.md` — addendum required: `--supabase-anon-key <ENV_VAR_NAME>`.
- All v2 references (PLAN §B/§D/§E/§G/§K; decisions.md D1-D4; Step 31d/35b/38/39/40/40b parallel/dependency references; src/cli/scan-command.ts:302-366, :1051-1063; src/types/validation-policy.ts:103-124; src/agents/sandbox-runner/outcome-classifier.ts:12-15, :65-118; src/core/orchestrator/required-evidence-ledger.ts:104-124).
