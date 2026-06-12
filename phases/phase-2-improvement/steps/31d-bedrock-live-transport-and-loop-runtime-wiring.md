# Step 31d — Bedrock live transport + loop runtime wiring (close 31b + 40 deferrals; first real AI scan)

**Status:** done (2026-05-29) — live Bedrock transport (Converse + `__done__` tool + invalid-default fail-closed on missing toolUse), SDK-chain auth, registry `available_via_sdk_chain` variant, loop-driver factory split, `runScan` Bedrock+Mode A branch routing, Bedrock+Mode B Cut-3 rejection, orchestrator construction moved below branch (V16), `--fail-on-blocker` exit-code propagation, Bedrock-default model substitution, `rawArgvProvider` deps seam, `--aws-session-token` argv guard, recorded-fixture path landed. Codex §6.5-r1 + §6.5-r2 reviews applied (all MUST + SHOULD). 889 tests pass, typecheck clean. Outstanding: real Bedrock recording (one-time operator capture under `AWS_PROFILE=preprod`).
**Maps to:** `phases/phase-2-improvement/PLAN.md` §B (loop is the orchestrator), §D (boundaries — esp. §D.1 result-parse-or-reject), §E (budget caps), §F (loop-trace fields incl. `model_id`), §H step 31b (live transport follow-up) + step 40 (runtime wiring follow-up); `phases/phase-2-improvement/decisions.md` D2 / D3 / D4 / D5; closes the two explicit deferrals in `phases/phase-2-improvement/steps/31b-bedrock-provider-adapter.md:3` and `phases/phase-2-improvement/steps/40-mode-b-cli-wiring.md:3`.
**Phase:** 3, Cut 1 (first AI-driven end-to-end scan; sits between 31b's recorded fixture and 41's full fixture-gate).

**Produces:**

- `src/ai/bedrock/transport-live.ts` — live `BedrockTransport` against `@aws-sdk/client-bedrock-runtime` Converse API. Auth resolution delegated to the AWS SDK default credential provider chain (`fromNodeProviderChain()` from `@aws-sdk/credential-providers`).
- **Amendment to `src/ai/registry.ts:80-94` (Bedrock entry).** The current entry declares `envVarName: 'AWS_ACCESS_KEY_ID'` + `requiresAdditionalEnv: ['AWS_SECRET_ACCESS_KEY', ['AWS_REGION','AWS_DEFAULT_REGION']]`, which causes `validateAiOptions` (`src/cli/scan-command.ts:616-656`) to early-reject `AWS_PROFILE=preprod` runs before `auth.ts` is reached. The entry is replaced with a new availability variant — `kind: 'available_via_sdk_chain'` — that the CLI early-reject treats as "presence verified by runtime SDK probe" and that requires only `AWS_REGION`/`AWS_DEFAULT_REGION` (the only non-secret AWS env that must exist somewhere in the chain). The static `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` are no longer hard requirements at the registry layer. The variant is implemented in `ProviderRegistry` so future providers using SDK-resolved creds register the same way (FPP §2A; no closed switch).
- **Amendment to `src/ai/bedrock/auth.ts:35-56`.** `readAwsCredentials()` becomes a chain-resolution presence check: returns `ok({ resolved: true, region, source })` when the SDK provider chain resolves anything (where `source ∈ 'static-env' | 'profile' | 'web-identity' | 'sso' | 'imds' | 'container' | 'process' | 'unknown'`); returns `err(MissingAwsCredentialsError)` otherwise. The function never returns or logs a resolved credential value (CLAUDE.md §Secrets). The `AwsCredentials` shape gains `resolved: boolean` + `source: string` and drops the `hasAccessKeyId`/`hasSecretAccessKey` presence booleans (those become meaningless under the chain).
- **Amendment to `src/cli/ai-provider-factory.ts`.** Today it returns `AiProvider` (the legacy `complete(request)` shape at `src/ai/types.ts:118-121`); the agentic loop needs the `AiDriver` shape (`proposeNext`) defined at `src/core/orchestrator/agentic-loop.ts:80-86`. The factory is split: `constructLoopDriver({ providerId, envReader, defaultModelId })` returns `{ id: ProviderId; driver: AiDriver }` and is the new entry point the loop path uses. The existing `constructAiProvider(...)` keeps the legacy `AiProvider` return for non-loop callers (the Phase 2 inference path); both routes share the provider registry, so adding a future provider is one entry plus one factory branch. A `bedrock` branch in the new function reads `AWS_REGION`/`AWS_DEFAULT_REGION` via `envReader`, builds `liveBedrockTransport()` OR — when `VEYRA_BEDROCK_RECORDING=<path>` is set — `recordedBedrockTransport(loadRecording(path))`, then returns `createBedrockProvider({ transport, modelId: defaultModelId ?? 'eu.anthropic.claude-sonnet-4-6' })`.
- **`src/cli/scan-command.ts` runtime routing.** A single decision point in `runScan(...)` placed **after** Supabase data-source setup (`:858-981`) + lockfile discovery (`:843`) + scanner-runner overrides are in hand, and **before** `registerPhase1Agents(...)` / `orchestrator.run(...)` (`:983-1010`). When `inputs.aiOptIn === true` AND `String(inputs.aiProvider) === 'bedrock'` AND the parsed loop options select Mode A, the new branch runs; for all other combinations the existing topo-sort path is unchanged. The branch builds a `ToolRegistry` via `deps.registerTools(...)`, constructs the loop driver via the new `constructLoopDriver(...)`, builds a `ToolContext` (`projectPath` — NOT the `AgentExecutionContext.projectRoot`; see Goal §note below), and calls `deps.loopFactory!({ registry, aiDriver, policy, context, artifactDir, caps })`. `--fail-on-blocker` is applied on the loop-path result before return; `--json` is rejected with a "JSON output is not yet wired on the agentic path (Cut 2 / Step 37 follow-up)" message — the topo path's JSON renderer is not reused here. The loop result is bridged to the markdown reporter (see below).
- **`--loop-budget` wired into `buildScanCommand()` + `parseRawOptions()` (`src/cli/scan-command.ts:1165-1271` + `:1288-1310`).** A `.option('--loop-budget <spec>', '…')` is added to the scan command; `parseRawOptions` threads it (and the raw argv array) through to `parseLoopCliOptions(...)` (`src/cli/loop-cli-options.ts:78-127`). This is the only way the budget-caps test (V4) and the credential-on-argv guard (V5a) can fire through the real `scan` command, since today `parseLoopCliOptions` is isolated.
- **`--aws-session-token` added to `FORBIDDEN_ARGV_FLAGS` (`src/cli/loop-cli-options.ts:66-72`).** Today the list covers `--aws-access-key-id` + `--aws-secret-access-key` but not the session token; this step adds it so the argv-credential guard matches the artifact-scan check (V5b).
- **Bridge from `AgenticLoopResult` to the markdown reporter.** Existing renderer: `renderAgenticReport(input: AgenticReportInput)` at `src/reporters/markdown/agentic-report.ts:48-87`. To populate `AgenticReportInput.trace.budget_consumed: BudgetSnapshot`, the loop result is extended to carry `budget_snapshot: BudgetSnapshot` (added to `AgenticLoopResult` at `src/core/orchestrator/agentic-loop.ts:145-151` — one new required field). The bridge counts `tools_called`/`denials`/`arg_rejects`/`tool_errors`/`result_rejects`/`subagent_errors` from `state.records()` (`src/core/orchestrator/artifact-state.ts:243-245`). Narrative is the deterministic fallback string (`narrative_used_fallback: true`) — full Step 36 narrative is Cut 2.
- **Bedrock-path `model_id` invariant — loop-level required audit field.** The current loop populates the trace row's `model_id` only when `envelope.model_id` is set (`agentic-loop.ts:301`, `:575`); driver errors before the first envelope and first-iteration budget halts can leave the field absent. On the Bedrock path the loop driver constructed by this step **guarantees `model_id` on every envelope** (the Bedrock provider already does this at `src/ai/bedrock/provider.ts:84`); additionally, the bridge layer sets a `model_id_required: true` flag in the trace writer so any trace row missing `model_id` on the Bedrock path triggers a test failure in V6. This is enforced at the loop level for the Bedrock path, not relied on as a provider-level "usually present" property.
- `@aws-sdk/client-bedrock-runtime` and `@aws-sdk/credential-providers` added to `dependencies` in `package.json`. Amendment to `src/ai/no-sdk-imports.test.ts:28-32`: the guarded-file list is unchanged (it does not include `bedrock/*.ts` today); the live transport lives at `src/ai/bedrock/transport-live.ts` which is outside `GUARDED_FILES` by construction — same containment pattern as `src/ai/anthropic.ts`. No edit to `FORBIDDEN_IMPORT_SUBSTRINGS`.
- **One recorded Bedrock-shape response fixture** under `examples/vulnerable-lovable-supabase/recordings/bedrock-loop-mode-a.json` (replayed by the existing `recordedBedrockTransport()` at `src/ai/bedrock/provider.ts:103-116`). The Markdown report rendered from a recorded-transport run is checked in as a content baseline. `loop-trace.jsonl` is NOT checked in as a byte-baseline (the `recorded_at` field at `agentic-loop.ts:564` is `new Date().toISOString()` wall-clock; making the trace byte-identical would require injecting `now` into the trace writer, which is a separate determinism step — flagged in Scope Check below).

**Depends on:** 31 (loop), 31b (recorded transport + provider + auth scaffolding), 33 (tool registry — read-only descriptors in leaf folders), 40 (`loop-cli-options.ts` parser + `ScanCommandDeps.loopFactory` seam at `:232` + default at `:1277`), 40b (factory seam).

**Executed by:** plain coding pass + `mcp-policy-check` skill (Bedrock is not MCP but the Supabase/Lovable allowlist + `read_only=true` + `project_ref` invariants on the loop path are asserted, V11) + `output-language-lint` skill on the rendered report + `step-reviewer` + codex single review at §6.5 (this is the second planning-level round; the next codex touch is at /step's §6.5 review of the actual implementation diff) + one operator-run live smoke scan against `examples/vulnerable-lovable-supabase/` with `AWS_PROFILE=preprod` + `AWS_REGION=eu-west-1`.

## Verification

`pnpm test --run` green; `pnpm typecheck` green; `pnpm lint` green. Enforceable assertions:

1. **Floor remains the sole `Finding` producer (`PLAN §D.1`/`§D.2`).** Test: drive `runAgenticLoop` with a stub driver that emits a syntactically-valid `invoke_tool` proposal whose tool returns a result carrying a top-level `finding_type` key. Assert: `result_schema.safeParse` rejects → `state` records `tool_result_reject` → `result.findings` contains zero `finding_type`s authored by the driver; every `Finding` returned originates from `runClassificationPredicates`. Pinned at the CLI integration boundary so the new runtime wiring cannot bypass it.

2. **Per-tool failure boundary (`PLAN §B`/`§D`).** Test: stub the transport to succeed but inject one tool whose `invoke` throws. Assert: the loop records a `tool_error` row, the floor still runs, the CLI still emits a Markdown report, exit code reflects findings only — not the tool throw.

3. **Result parse-or-reject boundary (`PLAN §D.1`).** Test: stub the transport to propose calls whose args + result both pass; switch one tool's result to violate `result_schema.strict()` at depth 3. Assert: `tool_result_reject` row present, raw result NEVER persisted (`state.writeToolResult` not called for that step), `collectAcceptedFacts` does not see it, baseline-unsatisfied → `coverage_gap` from the floor.

4. **Budget caps fire (`PLAN §E` / `decisions.md` D3).** Test: invoke `pnpm dev -- scan ... --loop-budget calls=2,wall_ms=300000,cost=2000000,steps=200` through the **real `scan` command** (proves the wiring of `--loop-budget` into `buildScanCommand` + `parseRawOptions` + `parseLoopCliOptions`); stub driver proposes three `invoke_tool` rows; assert termination is `budget_halt` after step 2, floor still runs, the report still renders, `loop-trace.jsonl` records the trip dimension.

5. **AWS creds never on argv + never in artifacts (CLAUDE.md §Secrets).**
   - (a) The credential-on-argv guard in `src/cli/loop-cli-options.ts:66-72` covers `--aws-access-key-id`, `--aws-secret-access-key`, AND `--aws-session-token`. Test: passing any of the three rejects at parse-time with `CliOptionError`. The raw-argv array is now threaded into `parseLoopCliOptions(...)` from `parseRawOptions`, so the guard fires through the real `scan` command (not just direct calls to the parser).
   - (b) After running a fixture scan with the recorded transport, walk every file under `<artifactDir>/` (`loop-trace.jsonl`, `*.json`, the Markdown report, any error artifact) and assert NONE contains the substrings of `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` env values (seed known fake values into the env, then assert absence). Region is allowed; the SDK profile name + chain `source` discriminator (the name `'profile'`, not the value) are allowed.

6. **`model_id` recorded on every Bedrock-path loop-trace row (`PLAN §F`).** Test: run with the recorded transport whose responses set `model_id = 'eu.anthropic.claude-sonnet-4-6'`; assert every row in `loop-trace.jsonl` carries `model_id: 'eu.anthropic.claude-sonnet-4-6'`. Includes rows for driver errors before any envelope arrives, first-iteration budget halts, and stall halts — the Bedrock-path bridge sets `model_id` on the trace snapshot at loop entry (from `defaultModelId`) and re-asserts on every envelope, so the field is required, not envelope-derived.

7. **Auth check accepts the SDK provider chain (closes the `AWS_PROFILE`-only blocker).** Test: with `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` UNSET but the SDK chain resolvable (mock `fromNodeProviderChain()` to return credentials), assert `readAwsCredentials()` returns `ok({ resolved: true, region: 'eu-west-1', source: 'profile' })` AND the registry-layer `validateAiOptions` accepts the run (proves the registry entry change — not just `auth.ts` — accepts a profile-only environment).

8. **Live transport opt-in, never on by default in tests (Phase 2 step 01 preventer 7).** Test: when `VEYRA_BEDROCK_LIVE=1` is absent, the live transport is not constructed in any vitest invocation; the recorded fixture is used end-to-end. Live smoke is gated behind `VEYRA_BEDROCK_LIVE=1` and the test reports `skipped_missing_env` when absent.

9. **Allowed-claims vocabulary preserved (CLAUDE.md §Output language).** The existing snapshot/lint assertion is at `src/reporters/markdown/agentic-report.test.ts:72-85` (not `agentic-report.ts`). This step's bridge produces input the renderer accepts unchanged, so the existing test continues to fire; additionally a new test renders the bridge's output from a sample `AgenticLoopResult` and re-asserts the forbidden-words regex returns no match AND at least three allowed verbs ("checked," "found," "missing," "appears launch-blocking," "needs human review," "likely") appear in the rendered narrative + cards.

10. **No regression in `--no-ai` baseline.** Test: the existing `--no-ai` fixture scan still emits its current control set + launch-blocker shape + finding count. The new routing in `runScan` does NOT touch the `--no-ai` path; assert by snapshot-diffing the existing `readiness-report.json` against the post-change run.

11. **MCP allowlist + `read_only=true` + `project_ref` invariants on the Bedrock loop path (CLAUDE.md §MCP discipline).** Test: run the Bedrock loop path against the fixture with a Supabase MCP client wired; assert every Supabase tool invocation carries `read_only=true` AND `project_ref=<inputs.supabaseProjectRef>`, that no descriptor is registered for a method outside `SUPABASE_ALLOWLIST`, that no `execute_sql` descriptor exists in the registry, and that the Lovable allowlist (`get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message`) is the exact descriptor set produced by `createLovableMcpTools(...)`. The check runs at the registry layer (not just the connector) so the loop-path wiring cannot bypass it.

12. **Required-evidence ledger row count + early-`done` gap emission.** Test: assert `RequiredEvidenceLedger(policy)` for `read_only_evidence` returns exactly `LEDGER_ROW_COUNT.mode_a = 6` rows (the CI-pinned constant at `src/core/orchestrator/required-evidence-ledger.ts:50`). Second test: stub the driver to propose `done` after one accepted result; assert `result.termination === 'early_done'`, `ledgerMissing.length === 5`, and the rendered report's "Coverage gaps" section enumerates five rows — one per missing `baseline_item_id`. Confirms the ledger emits one `coverage_gap` per missing row on early termination.

13. **Full trace field coverage (`PLAN §F`).** Beyond V6's `model_id`, assert each row of `loop-trace.jsonl` from a Bedrock-path fixture run carries all of: `prompt_fingerprint_sha256` (sha256 of the transport request body — populated by the provider, never the raw prompt), `policy_snapshot_hash` (constant per scan), `descriptor_schema_version_hash` (constant per scan), `result_validation ∈ {accepted, rejected, n_a}`, and `result_digest` (sha256 of the redacted parsed result) on every `tool_accepted` row. Read the JSONL back and check each field with a schema parse against the existing `LoopTraceRow` type.

14. **Redacted view fed to the AI driver, not raw artifacts.** Test: invoke the Bedrock loop path with a transport spy that captures the `view: LoopView` argument received in `proposeNext(...)`; pre-populate `ArtifactState` with a tool result containing a known secret-shaped value. Assert the captured view's `facts` contains the redactor's stable-alias placeholder, NOT the raw secret. Confirms the redaction at `agentic-loop.ts:285-288` runs before the AI sees the facts — V5b only checked persisted artifacts, this checks the in-process AI-facing view.

15. **No write-capable descriptors/actions in the Bedrock Mode A path.** Test: enumerate the registry built by `deps.registerTools(...)` on the Bedrock loop path; assert every descriptor's `required_action` lies in the Mode-A read-only `AllowedAction` subset (`policy.allowed_actions`) and the union of registered actions contains no write action. Proves "AI never decides cleanup" on this path by proving no write is in scope to decide on.

16. **`runScan` exercises `deps.loopFactory` on `--ai-provider bedrock` Mode A, never `orchestrator.run`** (SHOULD-CONSIDER §1). Integration test: a fake `loopFactory` records that it was called; a fake `orchestratorFactory` records that it was NOT. Assert both. Proves the new branch placement and that the existing seam (`scan-command.ts:232` + `:1277`) is finally invoked.

## Goal

Make a real AWS-Bedrock-driven Veyra scan invokable end-to-end against `examples/vulnerable-lovable-supabase/`. Today two seams exist (Step 31b's adapter + Step 40's parser + `ScanCommandDeps.loopFactory` default) but they are not connected:

- `liveBedrockTransport()` (`src/ai/bedrock/provider.ts:125-138`) throws.
- `readAwsCredentials()` (`src/ai/bedrock/auth.ts:35-56`) requires static `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, AND the `src/ai/registry.ts:84-93` Bedrock entry forces the CLI early-reject at `src/cli/scan-command.ts:616-656` to demand them too — so `AWS_PROFILE=preprod` fails before `auth.ts` is even called.
- `constructAiProvider(...)` (`src/cli/ai-provider-factory.ts:26-53`) throws for `bedrock` at line 50, AND returns the legacy `AiProvider.complete(...)` shape (`src/ai/types.ts:118-121`); the loop needs `AiDriver.proposeNext(...)` (`agentic-loop.ts:80-86`).
- `runScan(...)` calls `deps.orchestratorFactory()` and `orchestrator.run(context)` (`src/cli/scan-command.ts:839` + `:1010`) and never invokes `deps.loopFactory`, despite the default at `:1277`.
- `--loop-budget` is in `parseLoopCliOptions` (`src/cli/loop-cli-options.ts:78-127`) but is NOT in `buildScanCommand()` (`:1165-1271`) and NOT in `parseRawOptions()` (`:1288-1310`).
- The raw argv array is not threaded into `parseLoopCliOptions` from `parseRawOptions`, so the credential-on-argv guard cannot fire through the real `scan` command.

Note on `ToolContext` shape: `runScan` builds an `AgentExecutionContext` with `projectRoot` (`:831-837`), but the loop expects a `ToolContext` with `projectPath` (`src/core/tools/descriptor.ts:30-41`) + `src/core/orchestrator/agentic-loop.ts:153-158`. The bridge constructs a separate `ToolContext`; the two contexts are not unified in this step.

Drift note on `inputs.providerId`: the validated input field is `aiProvider: ProviderId` (`scan-command.ts:201`), not `providerId`. The branch checks `String(inputs.aiProvider) === 'bedrock'`.

Drift note on Mode B: `validateScanOptions` (`scan-command.ts:302-366`) ACCEPTS `sandbox_active_validation` with the existing approve/sandbox/CI gates today. This step does NOT change that. The Bedrock loop branch refuses Mode B on the **loop path** specifically (it routes Mode A only this step; Mode B is Cut 3 / Step 38-40), with a "Mode B is Cut 3" message — the existing topo-path Mode-B gates are untouched.

This step closes the seven gaps above in one coherent pass, behind `--ai-provider bedrock` + Mode A, with the recorded-fixture transport as the deterministic CI/test path and the live transport reachable only when AWS credentials are SDK-resolvable.

## What lands

- **Live transport (`src/ai/bedrock/transport-live.ts`).** A `BedrockTransport` whose `invokeModel`:
  - (a) lazily imports `@aws-sdk/client-bedrock-runtime` so a `--no-ai` scan or a recorded-fixture test never loads the SDK;
  - (b) constructs a `BedrockRuntimeClient` with `region` (from env) and `credentials` left to `fromNodeProviderChain()` (imported lazily from `@aws-sdk/credential-providers`, added to dependencies — SHOULD-CONSIDER §4 resolved by adding the package);
  - (c) issues a `ConverseCommand` with `toolConfig` derived from the typed proposal union (`invoke_tool` / `done` / `spawn_deep_dive`);
  - (d) extracts the tool-use response;
  - (e) returns a `BedrockStructuredResponse` whose `proposal` is the raw assistant tool-use payload — Zod-validated by the loop at `agentic-loop.ts:90-101` (`aiProposalSchema`), never trusted here. Cost is taken from `usage.totalTokens`; `prompt_fingerprint_sha256` is sha256 of the serialized request body.

- **Registry entry amendment (`src/ai/registry.ts`).** A new `availability` variant `{ kind: 'available_via_sdk_chain', requiredEnv: ['AWS_REGION'|'AWS_DEFAULT_REGION' (any-of)] }`. `validateAiOptions` (`scan-command.ts:616-656`) handles the new kind: under it the access-key/secret-key checks are skipped; only the region-any-of is required at the registry boundary. The runtime auth path (`auth.ts`) is the SDK-chain authority; the registry layer only confirms the run *could* succeed.

- **Auth amendment (`src/ai/bedrock/auth.ts`).** `readAwsCredentials()` calls the SDK provider chain once (via dynamic import of `@aws-sdk/credential-providers` so the test path that does not exercise auth never loads the package), captures only `{ resolved: true|false, region, source }`, never the resolved value. Failure path keeps `MissingAwsCredentialsError` with a message that names the chain and the env vars the SDK consults — never echoes any value back. CLAUDE.md §Secrets unchanged.

- **Loop driver factory split (`src/cli/ai-provider-factory.ts`).** New `constructLoopDriver({ providerId, envReader, defaultModelId }): Promise<{ id: ProviderId; driver: AiDriver }>`. The legacy `constructAiProvider(...)` keeps its `AiProvider` shape for non-loop callers. Both functions share the registry. A `bedrock` branch in the new function reads region from env, constructs `liveBedrockTransport()` OR `recordedBedrockTransport(loadRecording(VEYRA_BEDROCK_RECORDING))`, then returns `createBedrockProvider({ transport, modelId: defaultModelId ?? 'eu.anthropic.claude-sonnet-4-6' })`. Anthropic + OpenAI loop-driver branches are out of scope this step (they remain as legacy `AiProvider` adapters; their loop-driver wiring is a separate decision and lands when actually needed).

- **CLI runtime routing (`src/cli/scan-command.ts`).** A single conditional in `runScan(...)` after data-source setup + lockfile + scanner overrides are in hand (after `:981`, before `:983 registerPhase1Agents`). When `inputs.aiOptIn === true` AND `String(inputs.aiProvider) === 'bedrock'` AND the parsed loop options select Mode A:
  - parse loop options via `parseLoopCliOptions({ ...inputs, rawArgv: process.argv.slice(2) })`;
  - on Mode B, return a `CliUsageError` ("Mode B on the Bedrock loop path lands in Cut 3 / Step 38-40");
  - on `--json` set, return a `CliUsageError` ("JSON output is not yet wired on the agentic path; rerun without --json or wait for Cut 2") — SHOULD-CONSIDER §2;
  - build the registry: `const registry = createToolRegistry(); deps.registerTools!(registry, { rulesPath, lockfilePath, supabaseClient, lovableClient, runners })`;
  - build the driver: `const { driver } = await constructLoopDriver({ providerId: inputs.aiProvider, envReader: deps.envReader, defaultModelId: inputs.aiModel })`;
  - build a `ToolContext`: `{ scanId, projectPath: inputs.projectRoot, artifactDir }`;
  - call `const result = await deps.loopFactory!({ registry, aiDriver: driver, policy, context: toolCtx, artifactDir, caps: parsedLoop.loopBudget })`;
  - apply `--fail-on-blocker` against `result.findings` using the same predicate as the topo-path (`:1015-1024`);
  - bridge `result` to the markdown reporter (next bullet);
  - return.

  All other paths (`--no-ai`, no `--ai-provider`, `--ai-provider anthropic|openai`) continue to call the topo-sort orchestrator — no behavior change.

- **`--loop-budget` CLI wiring (`src/cli/scan-command.ts`).** `buildScanCommand()` gains `.option('--loop-budget <spec>', 'agentic-loop budget overrides as key=value,…  (calls,wall_ms,cost,steps); e.g. calls=40,wall_ms=300000')`. `parseRawOptions(raw)` threads `raw.loopBudget` into `ScanOptions` (new optional field) and forwards it (plus `process.argv.slice(2)` as `rawArgv`) to the loop branch's call to `parseLoopCliOptions(...)`.

- **`--aws-session-token` in `FORBIDDEN_ARGV_FLAGS`.** One-line addition to the array at `src/cli/loop-cli-options.ts:66-72`.

- **`AgenticLoopResult.budget_snapshot` (`src/core/orchestrator/agentic-loop.ts:145-151`).** One new required field: `readonly budget_snapshot: BudgetSnapshot`. Populated by calling `budget.snapshot()` once at loop exit, before the floor runs. The bridge feeds it into `LoopTraceSummary.budget_consumed` for the renderer.

- **Loop result → markdown bridge.** Compose a `LoopTraceSummary` (count `tools_called` / `denials` / `arg_rejects` / `tool_errors` / `result_rejects` / `subagent_errors` from `state.records()` filtered by `LoopRecordKind`; `budget_consumed` from `result.budget_snapshot`), pass to `renderAgenticReport(...)` with the deterministic fallback narrative + `narrative_used_fallback: true`. Write the markdown to `inputs.outPath`. No new reporter code; the renderer at `src/reporters/markdown/agentic-report.ts:48-87` ships today.

- **Bedrock-path `model_id` invariant.** The bridge layer wraps `deps.loopFactory` with a thin `model_id` injector for the Bedrock path: at loop entry it sets the `snapshot.modelId` (or, equivalently, the loop accepts a `requiredModelId: string | undefined` deps field that pre-seeds the snapshot at `agentic-loop.ts:227-232`). This guarantees every trace row carries `model_id` — including driver-error and first-iteration budget-halt rows — without changing the loop's general contract (`model_id` remains optional in `AiProposalEnvelope` for other providers).

- **Dependencies (`package.json`).** Add `@aws-sdk/client-bedrock-runtime` + `@aws-sdk/credential-providers`. Both are lazily imported by the live transport + the auth chain probe, respectively; a `--no-ai` scan or any recorded-fixture test path never loads them. SHOULD-CONSIDER §4 is addressed by adding the credential-providers package rather than avoiding the import.

- **No SDK-import-guard amendment needed.** `src/ai/no-sdk-imports.test.ts` guards only `types.ts` / `sanitization.ts` / `prompt-injection-detector.ts` (`:28-32`); `bedrock/transport-live.ts` lives outside that list, same as `anthropic.ts`. The substring guard's contract — "foundation files stay SDK-free" — is preserved untouched.

- **Recorded fixture + report baseline.** Capture one real Bedrock response from the operator's live smoke test (Mode A, fixture project) and check it in under `examples/vulnerable-lovable-supabase/recordings/bedrock-loop-mode-a.json`. The Markdown report rendered from a recorded-transport replay is checked in as a content baseline (a test re-runs the replay and asserts byte-identical Markdown — the renderer is deterministic given identical input). The `loop-trace.jsonl` is NOT checked in as a byte-baseline (see Scope Check).

## Done when

All sixteen Verification assertions pass. With `AWS_PROFILE=preprod` and `AWS_REGION=eu-west-1` exported, the command

```
pnpm dev -- scan --project examples/vulnerable-lovable-supabase --ai-provider bedrock --ai-model eu.anthropic.claude-sonnet-4-6 --mode read_only_evidence --env dev --out veyra-report.md
```

produces:
- (a) `examples/vulnerable-lovable-supabase/.veyra/scans/<id>/loop-trace.jsonl` with every row carrying `model_id: 'eu.anthropic.claude-sonnet-4-6'` + all §F audit fields populated;
- (b) the deterministic floor's findings (no `Finding` authored by the AI);
- (c) `veyra-report.md` rendered via `renderAgenticReport(...)`.

No AWS credential value appears anywhere under `.veyra/`. The `--no-ai` baseline scan against the same fixture remains byte-identical to today's output (V10).

(Per-tool result artifacts are NOT promised — `ArtifactState.writeToolResult()` at `src/core/orchestrator/artifact-state.ts:102-120` is in-memory only; persisting each accepted tool result to a file is a separate substrate change and is out of scope for this step. The floor reads in-memory accepted facts; `loop-trace.jsonl` carries the `result_digest` and `result_artifact_ref` is left empty until that substrate lands.)

## Guardrails

- **CLAUDE.md §Secrets:** AWS credentials are read by the SDK provider chain only; `auth.ts` never echoes a resolved value back. `loop-trace.jsonl` records `model_id` + `region` + the chain `source` discriminator (the *name* of the source, never the value). `--aws-access-key-id` / `--aws-secret-access-key` / `--aws-session-token` all parse-reject (V5a).
- **CLAUDE.md §Output language:** the bridge feeds the existing renderer; V9 reasserts forbidden-word absence + allowed-verb presence.
- **CLAUDE.md §Validation policy:** Mode A only this step. The Bedrock loop branch refuses Mode B with a "Cut 3" message — the existing topo-path Mode-B gates at `scan-command.ts:302-366` are untouched.
- **CLAUDE.md §MCP discipline:** Lovable allowlist + Supabase `read_only=true` + `project_ref` + no `execute_sql` descriptor — all asserted on the Bedrock loop path at the registry layer (V11).
- **`PLAN §D` (loop invariants):** floor sole `Finding` producer (V1); per-tool failure boundary (V2); result-parse-or-reject (V3); budget caps (V4); redacted view to AI (V14); no writes in Mode A scope (V15).
- **`FPP §2A` (opaque IDs, no closed unions):** the `bedrock` provider remains a single folder + a registered opaque `ProviderId`. The new `constructLoopDriver` branch reads `idStr` exactly as the legacy `anthropic`/`openai` branches do; no closed `type Provider = ...` union is introduced.
- **Phase 2 step 01 preventer 7:** live transport is recorded-from-real (the recorded fixture is captured from one operator-run scan) OR env-gated-live (`VEYRA_BEDROCK_LIVE=1`). Never mock-only (V8).
- **`no-cross-layer-imports`:** `src/ai/bedrock/transport-live.ts` lives outside `src/core/`; the loop calls it only via the `AiDriver` interface. Core stays import-clean.
- **Scope discipline (PHASE_1_PLAN §6 / FPP §18):** this step ships no dashboard, no Slack, no PR comment, no autonomous remediation, no compliance claim, no JSON output on the agentic path (deferred).

## Scope Check (explicit drops)

- **Deterministic byte-identical `loop-trace.jsonl` baseline — DROPPED from "Done when".** The `recorded_at` field at `agentic-loop.ts:564` uses wall-clock `new Date()`; making the trace byte-identical would require injecting a `now()` into the trace writer (and the agentic loop's `mapRecordToTraceRow`). That is a clean determinism change but it is fixture-gate territory (Step 41) and is intentionally not bundled here. The Markdown report baseline IS checked in as a content baseline — the renderer is deterministic given identical input.
- **Per-tool result artifacts — DROPPED from "Done when".** `ArtifactState.writeToolResult()` is in-memory only. Persisting each accepted tool result to a file is a separate substrate change and is not bundled into this step. The floor reads in-memory facts; the trace records `result_digest` over the redacted parsed result. If/when persistence lands, `result_artifact_ref` populates.

## References

- `phases/phase-2-improvement/PLAN.md` §B (loop body), §D (boundaries + invariants), §E (budget caps), §F (loop-trace fields incl. `model_id`), §H (Steps 31b + 40 deferred follow-ups this step closes).
- `phases/phase-2-improvement/decisions.md` D2 (Mode B default — out of scope this step), D3 (40/5min/token caps — V4), D4 (Bedrock — this step is its first real exercise), D5 (`--no-ai` write-probe → `coverage_gap` — V10 baseline preserved).
- `phases/FINAL_PRODUCT_PLAN.md` §2A (opaque IDs, one-folder-per-provider).
- `CLAUDE.md` §Secrets, §Output language, §Validation policy, §MCP discipline, §Scope discipline, §Resolved engineering decisions.
- `phases/phase-2-improvement/steps/31b-bedrock-provider-adapter.md:3`, `phases/phase-2-improvement/steps/40-mode-b-cli-wiring.md:3` (the deferrals this step closes).
- `src/ai/registry.ts:80-94` (Bedrock entry; the registry-layer change this step lands).
- `src/cli/scan-command.ts:616-656` (CLI early-reject — handles the new availability variant), `:201` (`inputs.aiProvider`), `:232` (`loopFactory` seam), `:302-366` (Mode B gates — unchanged), `:831-837` (`AgenticExecutionContext` — kept), `:839` + `:1010` (current `orchestratorFactory()` + `orchestrator.run(...)`), `:1015-1024` (`--fail-on-blocker` — replicated on Bedrock path), `:1129-1131` (`--json` — rejected on Bedrock path), `:1165-1271` + `:1288-1310` (`buildScanCommand` + `parseRawOptions` — `--loop-budget` added), `:1277` (`loopFactory` default).
- `src/cli/loop-cli-options.ts:66-72` (forbidden-argv list — `--aws-session-token` added), `:78-127` (`parseLoopCliOptions` — raw-argv guard now reachable via real `scan`).
- `src/cli/tool-registration.ts:41-82` (`registerReadOnlyTools` — the function the loop branch calls).
- `src/ai/bedrock/provider.ts:64-96` (`createBedrockProvider` — returns `{ id, driver }`), `:103-116` (`recordedBedrockTransport` — already in place), `:125-138` (`liveBedrockTransport` stub this step replaces).
- `src/ai/bedrock/auth.ts:35-56` (auth check this step amends).
- `src/ai/types.ts:118-121` (legacy `AiProvider.complete(...)` — kept for non-loop callers).
- `src/cli/ai-provider-factory.ts:26-53` (`constructAiProvider` — kept; new `constructLoopDriver` added).
- `src/core/orchestrator/agentic-loop.ts:80-86` (`AiDriver` shape), `:90-101` (`aiProposalSchema` — fail-closed parse), `:145-151` (`AgenticLoopResult` — `budget_snapshot` added), `:197-208` (loop entry), `:227-232` + `:301` + `:564` + `:575` (`model_id` plumbing — Bedrock path injects).
- `src/core/orchestrator/artifact-state.ts:102-120` (`writeToolResult` — in-memory only; explains the per-tool-artifacts drop), `:243-245` (`records()` — bridge reads).
- `src/core/orchestrator/loop-trace-writer.ts:47-61` (`LoopTraceRow` shape — V13 reads back).
- `src/core/orchestrator/required-evidence-ledger.ts:50` (`LEDGER_ROW_COUNT` — V12 pins).
- `src/core/tools/descriptor.ts:30-41` (`ToolContext` — `projectPath`, NOT `projectRoot`).
- `src/reporters/markdown/agentic-report.ts:48-87` (`renderAgenticReport` — bridge target), `agentic-report.test.ts:72-85` (the existing forbidden-word lint test — V9 extends).
- AWS SDKs and Tools — default credential provider chain (the SDK-side authority for `AWS_PROFILE` / role-chaining; replaces the static-keys-only check in V7).
- AWS Bedrock Runtime — `Converse` + `toolConfig` (the structured-tool-use surface).
