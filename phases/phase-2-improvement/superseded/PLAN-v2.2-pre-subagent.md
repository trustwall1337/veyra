# Phase 3 — Agentic Veyra (PLAN-v2.2: agentic-loop foundation, codex round-2 revision)

**Status:** revision of PLAN-v2.1 incorporating codex round-2 (6/8 round-1 RESOLVED; findings 2 + 7 PARTIAL; +1 new). Supersedes everything in `superseded/`. Topo-sort orchestrator removed, not preserved.
**Date:** 2026-05-27
**Reviewer:** codex (3 rounds — r1: 5 MUST + 3 SHOULD; r2: closed 6, residual 2+7, +1 new; this is the round-3 submission, the final round).
**Theme:** make the deterministic-floor preservation mechanically testable AND un-bypassable at the loop boundary — not just at the post-loop construction site. Tool results are parsed-or-rejected before they persist or feed the floor. The required-evidence ledger is a checked-in typed table whose row count is CI-pinned.

The load-bearing inversion: **the agentic loop is the orchestrator.** AI proposes the next tool call; a deterministic policy gate authorizes it; a deterministic tool executes it; **the result is parsed against the tool's `result_schema` before it is allowed to persist or feed the floor**; the redacted result is written to the artifact store; the loop repeats until a deterministic termination condition fires. AI never produces a Finding, never classifies, never decides cleanup, never holds a raw secret, never writes outside an allowlist.

## §A. Diagnosis — 10 Observations under agentic framing

| Obs | Classification | Why |
|---|---|---|
| 1 universal 12 controls | FUNDAMENTAL — resolved | Loop reasons over artifacts; control list no longer iterated. |
| 2 AI segregated | FUNDAMENTAL — resolved by inversion | AI is decision-maker about what to check; never classifies. |
| 3 catalog-bound test types | FUNDAMENTAL — resolved with safety floor | AI authors method/URL/body within `requestSchema`; catalog → typed probe primitives + cleanup contracts. |
| 4 operator inputs over-specified | SURFACE — partial | Loop can call discover-actors; manifest default unless ratified. |
| 5 regex parser | ACCEPTABLE-TRADEOFF | Parser becomes `read-schema` tool; brittleness disclosed. |
| 6 per-control report | SURFACE (downstream) | Narrative renders above cards (PLAN-v1 §D.A mechanism). |
| 7 templated coverage gaps | SURFACE | Gap = loop terminated without required evidence (§K ledger). |
| 8 deterministic classification | ACCEPTABLE-TRADEOFF — preserved, schema-enforced at the loop boundary | In-loop tool-result schemas forbid classification keys at any depth + parse-or-reject before persist/floor (§B, §D.2, Step 30/35). |
| 9 19 CLI flags | SURFACE — partial | AI-tuning flags → `--loop-budget`; full inference deferred. |
| 10 bolt-on pattern | PROCESS — closed | Inverting the foundation is the only honest answer. |

## §B. Agentic loop architecture (chosen)

`src/core/orchestrator/agentic-loop.ts` replaces `scan-orchestrator.ts`.

```
run(context, toolCatalog, policy, aiDriver, budget):
  state  = ArtifactState(context.artifactDir)        # append-only
  ledger = RequiredEvidenceLedger(policy)            # §K checked-in typed table; NOT catalog-derived
  step   = 0
  while true:
    step += 1
    proposal = aiDriver.proposeNext(state.readableView(), toolCatalog.descriptors())
    logStep(step, prompt_fingerprint_sha256, model_id, policy_snapshot_hash, descriptor_schema_version_hash, proposal)
    if proposal.kind=='done':
        record done
        if not ledger.baselineSatisfied(state): record early_done(ledger.missing(state))
        break
    if budget.exceeded(...): record budget_halt; break
    if state.noProgress(window): record stall_halt; break
    tool = toolCatalog.resolve(proposal.tool_id)      # registry lookup; no central switch
    if tool is None: record unknown_tool; continue
    gate = policyGate.authorize(tool, proposal.args, policy, state)
    if not gate.allowed: state.recordDenial(tool.id, gate.reason); continue
    parsedArgs = tool.args_schema.safeParse(proposal.args)
    if not parsedArgs.ok: state.recordArgReject(...); continue
    t0 = clock()                                       # per-tool failure boundary (r1 MUST #1)
    try:
      result = await tool.invoke(parsedArgs.value, context, policy)   # Result<T,E>, redacts before return
    except cause:
      state.recordToolError(tool.id, error_class=cause.constructor.name, duration=clock()-t0); continue
    # RESULT-PARSE-OR-REJECT AT THE LOOP BOUNDARY (r2, closes finding 2)
    parsedResult = tool.result_schema.safeParse(result)        # .strict(), recursive-key-forbidding
    if not parsedResult.ok:
      state.recordToolResultReject(tool.id, reason=parsedResult.error.summary, duration=clock()-t0)
      continue                                         # raw result NEVER persisted; baseline stays unsatisfied → §K gap
    state.writeToolResult(tool.id, parsedResult.value, digest=sha256(parsedResult.value), duration=clock()-t0)
  # deterministic floor AFTER the loop:
  facts     = collectFacts(state)                     # reads ONLY parsed-accepted results; never raw invoke output
  findings  = runClassificationPredicates(facts, ledger.gaps(state))  # SOLE Finding producer (Obs 8)
  cleanup   = runCleanupPhase(state.writeRegistry, state.adminRegistry)   # both write paths (§D.3)
  narrative = renderNarrative(claimLinter(narrativeAuthor(findings, state)))
  report    = render(findings, narrative, cleanup, state.loopLog)
```

Runner-up: ReAct free-text — rejected (un-gateable, unprovable audit). Tradeoff: lower ceiling vs provable gate+audit.

**Result boundary (r2, closes finding 2 partial).** `result_schema.strict()` is inert unless every `invoke` return is parsed *before* anything downstream sees it. v2.1 validated only args; v2.2 adds mandatory parse-or-reject on the result between `invoke` and both `writeToolResult` + `collectFacts`. Parse failure → `tool_result_reject` fact+artifact (reason only, no raw payload), nothing persisted, `continue`. `collectFacts` reads only parsed-accepted results, so a malformed/classification-bearing result can never reach the floor. Step 31 owns boundary; Step 30 owns `result_schema` strictness; Step 41 asserts.

**Per-tool failure boundary (r1 MUST #1).** Relocates `scan-orchestrator.ts:185/329` (catch throw → coverage_gap → error artifact → continue) into the loop: throw → `tool_error` fact+artifact, never rethrows, floor still runs. Step 31 owns; Step 41 asserts.

Tool catalog: `ToolDescriptor {tool_id: ToolId, title, args_schema (Zod), result_schema (Zod, .strict(), recursive-key-forbidding), required_action, invoke}`. AI sees only `descriptors()`. One folder per family; no central switch (FPP §2A). `ToolId` opaque branded.

**Tool placement (codex round-3 final blocker — layering rule).** `no-cross-layer-imports.test.ts:10` forbids `src/core/**` from importing `src/agents`/`src/connectors`/`src/scanners`. Therefore: **`src/core/tools/` owns ONLY the abstractions** — the `ToolDescriptor` type, the `ToolId` brand, the registry contract, the result-schema base + recursive guard. **Concrete tool descriptors (whose `invoke` imports a scanner/connector/agent implementation) live in their own leaf service folders** — e.g. `src/scanners/gitleaks/tool.ts`, `src/connectors/supabase/tools/read-schema-meta.ts`, `src/agents/supabase-rls/tools/read-schema.ts`. **Registration happens in a non-core layer** — `src/cli/tool-registration.ts` (the successor to today's `src/cli/agent-registration.ts`, which already lives outside core for exactly this reason). The registry in core never imports a concrete tool; the CLI registration layer imports both core (the contract) and the leaf folders (the descriptors) and wires them. This keeps `src/core` import-clean and satisfies `no-cross-layer-imports.test.ts`.

Termination (deterministic): AI `done` / budget cap / no-progress stall / loop-driver hard error. All four: floor runs, §K ledger evaluated.

## §C. Tool catalog design

- **Scanners** → `run-gitleaks`/`run-osv`/`run-semgrep`, `read_scanner_logs`. Gitleaks descriptor hard-binds `--redact` (not a schema field).
- **MCP calls** → ONE tool per allowlisted method. **Descriptor universe derived mechanically from `SUPABASE_ALLOWLIST` (policy.ts:38) + Lovable allowlist** — no hand-list. `execute_sql` ∈ `DENIED_TOOLS` (:50), ∉ allowlist ⇒ no descriptor. `checkInvocation` (:71) + `invoke` (client.ts:97) remain invoke-time defense-in-depth.
- **Existing agents** → DECOMPOSED into tools (read/parse → tools; classify → floor). Runner-up whole-agent-as-tool rejected (reburies Obs 1/2).
- **Sandbox-runner 13 entries** → composable probe primitives; outcome-assertion → floor classifier; request shape AI-authored within `requestSchema`; writes via `executeWriteWithRegistry()`.
- **read-file / read-schema** → first-class tools; read-file is `read_code`, path-traversal-guarded.

**Tool results carry no classification, at any depth (r1 MUST #2, hardened r2).** `ToolResult` base (`src/types/tool-result.ts`, new) makes `finding_type`/`review_action`/`evidence_strength`/`blast_radius`/`reproducibility` not assignable (compile, `@ts-expect-error` test) and forbids them **recursively** at runtime. **Chosen: whitelist-only fact-payload shape** — tool results constrained to a small set of primitive/record fact types whose keys cannot collide with classification keys, so a forbidden key is un-representable even nested. Runner-up recursive deny-walk over arbitrary objects — rejected as the contract (deny-lists drift), kept only as a Step 30 belt-and-suspenders test. Tradeoff: whitelist constrains what a tool may return (intentional) vs deny-walk permissiveness.

## §D. Trust-model amendments

1. **AI never produces a Finding** → SURVIVES, schema-enforced at boundary. In-loop `ToolResult` un-assignable (compile) + un-representable any depth (runtime whitelist) + parse-or-reject before persist/floor. Step 35 sole `Finding` constructor.
2. **AI never sets classification** → SURVIVES, schema-enforced. Relocation of `predicates.ts:194` (`predicateRlsMissing` sets `finding_type:'likely_issue'`), `:395` (`predicatePrivilegedClientKey`), `agent.ts:773/787` (`predicateFindings`/`allFindings` inline): fact half → tool results; classification half → Step 35 floor. Tests §D.2.
3. **AI never decides cleanup** → REBALANCED **[RATIFY]**. AI authors writes; cleanup grows to both paths (§D.3). AI cannot skip/defer/scope cleanup.
4. **AI never holds raw secrets** → SURVIVES + ADDITION. Results re-entering loop view redacted (stable-alias) before AI sees them; trace logs `result_digest` of redacted result + `alias_map` ref, never raw.
5. **AI never writes MCP outside allowlist** → SURVIVES, stronger. No descriptor for non-allowlisted method; gate re-checks; `checkInvocation` denies at connector.
6. **AI never calls Supabase MCP without read_only+project_ref** → SURVIVES VERBATIM. Tool builds invocation; `checkInvocation`/`invoke` inject both + reject reserved keys.

Net: 5 survive (2 schema-enforced), 1 rebalances (#3, ratify).

**§D.1 — result-parse-or-reject boundary (r2 finding 2).** Ordering fixed and tested: `invoke` → `result_schema.safeParse` → on reject `tool_result_reject` (reason-only) + `continue` (no persist) → on accept `writeToolResult` (digest of parsed value). `collectFacts` reads only persisted-accepted results. Step 31 Done-When asserts boundary + no raw-output path to floor.

**§D.2 — classification cannot enter the loop (three tests).** (i) Compile guard: `@ts-expect-error` a `ToolResult` with top-level classification key. (ii) Runtime recursive guard: a result carrying `finding_type` nested below top level fails `safeParse` → `tool_result_reject`, floor still runs. (iii) **Broadened import-graph guard (r2; entrypoint set corrected per codex round-3):** a checked-in graph-walk that starts from **every registered concrete tool entrypoint — wherever it lives** (`src/scanners/*/tool.ts`, `src/connectors/*/tools/*`, `src/agents/*/tools/*`, plus the core registry contract) — NOT just `src/core/tools/**`, since per the placement rule concrete tools live in leaf folders, not core. The walk follows transitive helper imports and asserts `Finding` (`src/types/finding.ts`) is unreachable from any reachable node. Earlier wording (only `src/core/orchestrator/` + `*-tool.ts`, then only `src/core/tools/**` + agents) was too narrow. The walk resolves TypeScript imports transitively (not grep) so a re-export/alias cannot launder `Finding`. The entrypoint set is derived from the `tool-registration.ts` registration list so a newly-registered tool is automatically in scope. Step 35 owns.

**§D.3 — both write paths (r1 MUST #4).** Path 1 HTTP: `sandbox-runner/agent.ts:155` `transport.send()` → routed through `executeWriteWithRegistry()` (sole write entry, lint-guarded). Path 2 Admin SDK: `synthetic-data-manager/agent.ts:111` registry kept + unified under one `WriteRegistry` contract; post-loop cleanup reads both → one `cleanup_proof`/`residual_count`. Cleanup failure either path → `cleanup_failed` launch-blocker. Step 38 names both; Step 41 roundtrips both.

## §E. Termination + budget + fallback

Done → floor always runs + §K ledger evaluated (premature `done` → `early_done` + per-missing floor `coverage_gap`). Budget caps (three, first-trips-wins): `max_tool_calls` (~40), `max_wall_clock_ms` (~5 min), `max_ai_cost_units`; denials/rejects/tool-errors/tool-result-rejects count; `max_steps` backstop. CLI `--loop-budget`.

**`--no-ai` plan-walker (r1 MUST #5, option b).** Read-only tools full coverage; write probes needing AI-authored target → floor `coverage_gap`. Runner-up (a) static arg providers rejected (second planning engine = second determinism-drift surface). Step 32: plan-walker + read-only parity test + write-probe-`coverage_gap` test.

## §F. Audit trail

`loop-trace.jsonl` (`ArtifactKind: loop_trace`), per step: `step, recorded_at, model_id, prompt_fingerprint_sha256, proposal_kind, tool_id?, args_redacted?, gate_decision, gate_reason?, arg_validation, **result_validation (accepted/rejected/n_a), result_reject_reason?**, invoke_status, result_artifact_ref?, budget_snapshot, policy_snapshot_hash, descriptor_schema_version_hash, tool_duration_ms?, result_digest? (of redacted parsed result), tool_error_class?, state_view_digest, alias_map_artifact_ref?`. No raw secret anywhere. Append-only, per-step write. Step 34.

## §G. Existing-work accounting

**REBUILD:** P1 18/18b (orchestrator → loop; salvage `hypothesis-disposition`; failure boundary :185/329 relocated); P2 14 (two-phase → loop+floor; scan-actions-log → loop-trace; crash-cleanup preserved).
**DEPRECATE:** P1 08d (ai-inference); P2 09 (ai-explainer → narrative-author); P2 07b (ai-security-planner; deterministic-fallback → Step 32); P2 07c compiler guarantees → gate + §K ledger.
**AMEND:** P1 05b/06b/07b; P1 15/16/24-27 (per-method descriptors from allowlist); P1 09b/10b/11b/12b (classify → floor, read/parse → tools); P1 08c (→ gate); P2 06/06b (Admin registry unified §D.3); P2 07/07d (probe-primitive split); P2 08 (probe-http via registry + deterministic classifier); P1 13/13b + P2 12 (reporter + narrative + loop-trace summary); P1 14/14b + P2 10e (floor classification + readiness); P2 10a-10d; P1 29 / P2 11 (CLI wires loop); **NEW P1 03/03b CLI factory + registration (§G.1, Step 40b).**
**KEEP AS-IS:** P1 02/02b (extend ArtifactKind additively); adapters 05/06/07, 02c/02d, 04/04b; `tool-policy.ts` `enforce()`; connector allowlist files (verbatim, now also descriptor source); P2 step01 preventers 7+8; `validation-policy.ts`, `sanitization.ts`; `SupabaseClient.invoke`/`checkInvocation`.

**§G.1 — CLI factory + registration migration (r1 SHOULD #8).** Sites: `scan-command.ts:13/19/222/791/935/1228`, `agent-registration.ts:114`. Migration: `orchestratorFactory: () => ScanOrchestrator` → `loopFactory: () => AgenticLoop` (stays injected in `ScanCommandDeps` — r2 confirmed no circular dep, fake-runner seam preserved); `registerPhase1Agents` → `registerTools(catalog)`; migrate test imports. Step 40b. Done-When: no production import of `createScanOrchestrator`/`registerPhase1Agents`/`ScanOrchestrator` outside `superseded/`; structural test asserts.

## §H. Steps (from 30)

| # | Title | Depends | Scope |
|---|---|---|---|
| 30 | **Core abstractions only** (per placement rule): `ToolId` + `ToolDescriptor` + registry contract + in-loop `ToolResult` base forbidding classification keys **recursively** (compile `Exclude` + `.strict()` + whitelist-only fact-payload + belt-and-suspenders deny-walk test) + dependency test. **No concrete tool in `src/core`.** Extend ArtifactKind (`loop_trace`, `tool_error`, **`tool_result_reject`**, `required_evidence_ledger`, alias-map) | none | M |
| 31 | Agentic loop driver (provider-agnostic `AiDriver`/`AiProvider` interface) + gate inner step + budget caps (D3: 40 / 5min / token cap) + **per-tool failure boundary** + **result-parse-or-reject boundary (§D.1)** | 30 | L |
| 31b | **(D4) AWS Bedrock provider adapter** — new `bedrock` adapter behind `AiProvider` (one folder, opaque `ProviderId`, no closed union per FPP §2A). AWS SigV4/IAM auth via env (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` or profile); Bedrock Converse/`InvokeModel` for Claude; prompt caching + structured tool-use + `model_id` audit route through it. Bedrock is the default concrete loop-driver provider; direct-Anthropic (P2 step 04) + OpenAI remain available adapters. Secret stays env-only (never argv/artifact/trace). | 31 | M |
| 32 | `--no-ai` plan-walker + read-only parity test + write-probe→`coverage_gap` test | 30,31 | M |
| 33 | **Concrete read-only tool descriptors in leaf folders** (`src/scanners/*/tool.ts`, `src/connectors/*/tools/*`, `src/agents/*/tools/*`) + `src/cli/tool-registration.ts` wiring layer (non-core; imports core contract + leaf descriptors). MCP descriptors from allowlist; tests (a) no generic call-mcp (b) no execute_sql descriptor (c) invoke-time denial fires (d) **no concrete tool imported into `src/core`** (`no-cross-layer-imports` stays green) | 30 | M |
| 34 | Loop-view redaction + audit trail with all §F fields (incl. result_validation) | 31 | M |
| 35 | Deterministic floor: classification predicates over loop facts. Tests (i) compile guard (ii) runtime recursive-key reject (iii) broadened import-graph walk (`Finding` unreachable from tools + agents-as-tools + transitive helpers) | 31,33 | L |
| 36 | Narrative author + claim-linter + deterministic renderer (carry PLAN-v1 §D.A) | 35 | L |
| 37 | Reporter: narrative + per-control cards + loop-trace summary | 35,36 | M |
| 38 | Unified write cleanup: `executeWriteWithRegistry()` sole HTTP entry (Path 1) + Admin registry unified (Path 2) under one `WriteRegistry` + reverse-walk both + direct-write lint guard; failure → `cleanup_failed` launch-blocker | 31 | L |
| 39 | Probe-primitive split: per-primitive `requestSchema` + AI request authoring within bounds + outcome classifiers; writes via Step 38 | 38,35 | L |
| 40 | Mode B CLI wiring: loop + `--loop-budget` + approval + `--no-ai` | 31,32,38,40b | M |
| 40b | CLI factory + registration migration (§G.1); structural test | 31,33 | M |
| 41 | Fixture gate: agentic e2e + determinism + write-then-cleanup roundtrip both paths + trust-invariant assertions + per-tool failure-boundary assertion + **result-reject-boundary assertion** + required-evidence-ledger assertions (early `done` → per-missing `coverage_gap`; **ledger row-count constant pinned**) | 31-40b | L |

Forward stub: Phase 4 placeholder (operator-surface reduction + B.2-as-default), status `not started`.

## §I. Decisions — RATIFIED 2026-05-27 (see `decisions.md`)

1. **Cleanup-aware write authority (§D.3).** ✅ RATIFIED: YES, registry-gated, no bypass. (D1)
2. **Mode B default (preventer 10).** ✅ RATIFIED: **FLIP to auto-synthesize (B.2)** — OVERRIDES planner recommendation, AMENDS preventer decision 10. Default Mode B requires a service-role key (env-only); Veyra creates + cleans up synthetic users; no manifest required by default. B.1 manifest becomes opt-in. README + CLAUDE.md must state the service-role-key default plainly. (D2)
3. **Loop budget defaults.** ✅ RATIFIED: 40 calls / 5 min / token cap; `--loop-budget` override. (D3)
4. **AI provider for loop driver.** ✅ RATIFIED: **Anthropic via AWS Bedrock** (Step 31b new). Provider-agnostic interface; Bedrock is the default concrete provider; direct-Anthropic + OpenAI remain adapters. (D4)
5. **`--no-ai` write-probe promise (§E).** ✅ Accepted by default (option b: read full, write → `coverage_gap`). User may override. (D5)

## §J. Decisions the planner picks

1. Typed-proposal union (vs ReAct) — provable gate+audit.
2. Agents decomposed into tools (vs whole-agent-as-tool) — avoid reburying Obs 1/2.
3. One descriptor per allowlisted MCP method from allowlist (vs generic call-mcp; vs hand-list).
4. `--no-ai` plan-walker, write probes → `coverage_gap` (vs static arg providers).
5. Classification in post-loop floor + schema forbids classification keys in-loop recursively + parse-or-reject at result boundary (vs in-loop classify; vs prose).
6. Carry PLAN-v1 §D.A narrative + §D.F write-safety intact (vs redesign).
7. Per-tool failure boundary inside loop (vs whole-loop try).
8. Result schema = whitelist-only fact-payload (vs deny-walk as contract).
9. Required-evidence ledger = checked-in literal table, row-count CI-pinned (vs catalog-derived).

## §K. Trust-model risks + guardrails + required-evidence ledger

**Required-evidence ledger (concrete typed table — r1 SHOULD #7, made explicit r2).** `RequiredEvidenceLedger` (`src/core/orchestrator/required-evidence-ledger.ts`, new; `ArtifactKind: required_evidence_ledger`), deterministic, parameterized by `ValidationPolicy`, **checked-in literal table, NOT catalog-derived**. Row: `{baseline_item_id, required_action, satisfied_by:(state)=>boolean, gap_control_id}`. `satisfied_by` reads only immutable loop facts via `state.hasArtifact(...)` + `state.toolSucceeded(tool_id)` (true iff invoke produced an *accepted* §D.1-parsed result; `tool_error`/`tool_result_reject` ≠ success).

Mode A (`read_only_evidence`) rows (6): `schema_meta_read` (`hasArtifact('database-metadata.json') && toolSucceeded('read-schema')` → cc-11-5); `storage_meta_read` (→ cc-11-6; if no `StorageMetadataSource` → false → coverage_gap, never silent); `scanner_secrets_run` (`toolSucceeded('run-gitleaks')` → cc-11-7); `scanner_deps_run` (`run-osv`); `scanner_sast_run` (`run-semgrep`); `declared_surface_read` (`toolSucceeded('read-file')` ≥1).
Mode B adds (2): `actor_session_established` (`hasArtifact('actor-sessions.json') && toolSucceeded('establish-actor-session')`); `declared_probe_attempted` (`hasArtifact('http-write-registry') && ≥1 declared probe attempt`).

**Deliberate-row-addition rule (r2 finding 7).** The table is a checked-in literal; adding/removing/editing a row is a deliberate edit, NEVER catalog-derived. CI-pinned `LEDGER_ROW_COUNT` (Mode A=6, Mode B-add=2); a test asserts actual==constant so a silent change (e.g. derive-from-catalog regression) trips CI. Step 30 lands table+constant; Step 41 asserts.

Loop computes `baselineSatisfied(state)` at `done`; early `done` → `early_done` + one floor `coverage_gap` per missing row citing trace + `baseline_item_id` + `gap_control_id`. AI cannot suppress baseline by terminating early.

Risks: selection bias → ledger coverage_gap; premature termination → `early_done` + per-item gap; gate-denial gaming → counts vs budget, deterministic gate, repeated → stall_halt; prompt injection from tool outputs → no execute_sql descriptor, outputs redacted + framed as data, gate by descriptor, **result parse-or-reject strips classification-shaped injection before floor**; cost/wall-clock runaway → three caps + max_steps; hallucinated args → Zod safeParse + `requestSchema` bounds; **malformed/poisoned result → parse-or-reject → `tool_result_reject`, nothing persisted, baseline unsatisfied → coverage_gap**; AI invents nonexistent tool → `unknown_tool`; tool crash → per-tool boundary `tool_error`, floor+cleanup run; write-cleanup hole → `executeWriteWithRegistry` sole HTTP entry + Admin registry unified + direct-write lint failure + `cleanup_failed` launch-blocker.

## §L. Sequencing

- **Cut 1 (minimum first-shippable):** 30,31,32,33,34,35,40b,41-partial. Full agentic flow over read-only tools; deterministic floor; result-reject boundary; `--no-ai` parity; audit; per-tool failure boundary; CLI migrated. Near-zero new trust surface (no writes).
- **Cut 2:** 36,37. Narrative reframe.
- **Cut 3:** 38,39,40,41-complete. Mode B AI-authored writes + unified registry + cleanup roundtrip. Highest trust surface; ships last.

## §M. README update plan

Lands after §I ratification + step files pass codex; own codex pass. (1) What Veyra is — agentic analyzer bounded by deterministic gate + floor. (2) How a scan works incl. "every tool result is checked before it is recorded." (3) Trust boundaries — six invariants; classification + cleanup never AI-decided; results parsed-or-rejected before persist. (4) Trust-mode matrix:

| Mode | Credential | What AI may author | Writes? | Cleanup | `--no-ai` |
|---|---|---|---|---|---|
| A | project path; optional read-only MCP | which read tools, in what order | none | n/a | static plan-walker, full Findings |
| **B.2 (DEFAULT per D2)** | **service-role key (env-only)** | actor synthesis + read tools + probe request shapes within `requestSchema` | yes, registry-tracked (HTTP+Admin) | deterministic reverse-walk over both, mandatory on crash, `residual_count: 0` | read full; write probes → coverage_gap |
| B.1 (opt-in) | sandbox + declared actors (no service-role key) | read tools + probe request shapes within `requestSchema` | yes, registry-tracked (HTTP+Admin) | reverse-walk over both, `residual_count: 0` | read full; write probes → coverage_gap |
| C | reserved | reserved | reserved | reserved | reserved |

(D2: B.2 is the documented Mode B default; B.1 manifest is the opt-in for operators unwilling to provide a service-role key. Amends preventer decision 10.)

(5) Audit — loop-trace reconstruction; snapshot hashes prove what was in force; `result_validation` shows rejected returns. (6) Allowed-claims — never secure/safe/compliant; README through `output-language-lint`.

## §N. Disposition of codex findings

### §N.1 round-1 (codex r2 confirmed 6/8 RESOLVED)
1 RESOLVED (per-tool boundary). 2 PARTIAL→closed §N.2. 3 RESOLVED (allowlist-derived descriptors). 4 RESOLVED (both write paths). 5 RESOLVED (§E option b). 6 RESOLVED (audit fields). 7 PARTIAL→closed §N.2. 8 RESOLVED (§G.1 + Step 40b).

### §N.2 round-2 residuals + new
| Finding | APPLIED |
|---|---|
| [MUST,p] result_schema inert unless parsed before persist/floor | §B result-parse-or-reject boundary; §D.1; `collectFacts` reads only accepted; Step 31 + 41 assert |
| [MUST,p] forbid classification keys recursively | §C whitelist-only fact-payload + `.strict()` + deny-walk test; §D.2(ii); Step 30/35/41 |
| [MUST,p] import-graph guard too narrow | §D.2(iii) graph-walk from each tool `invoke` over `src/core/tools/**` + `src/agents/**`-as-tools + transitive helpers; Step 35 |
| [SHOULD,p] ledger still prose | §K concrete typed table, 6 Mode-A + 2 Mode-B rows, exact `satisfied_by` predicates; Step 30 |
| [SHOULD,p] row addition must be deliberate | §K checked-in literal + CI-pinned `LEDGER_ROW_COUNT`; Step 30/41 |
| [new] `ArtifactKind: tool_result_reject` | Step 30 additive list; §F trace fields; §K risk row |

### §N.3 round-3 (final) finding
| Finding | APPLIED |
|---|---|
| [FINAL blocker] concrete tools cannot live in `src/core/tools/**` — `no-cross-layer-imports.test.ts:10` forbids `src/core/**` importing agents/connectors/scanners | §C placement rule: core owns only `ToolDescriptor`/`ToolId`/registry contract/result-schema base; concrete descriptors live in leaf folders (`src/scanners/*/tool.ts`, `src/connectors/*/tools/*`, `src/agents/*/tools/*`); registration in non-core `src/cli/tool-registration.ts`. §D.2(iii) import-graph guard entrypoint set corrected to every registered concrete tool wherever it lives (derived from `tool-registration.ts`), not `src/core/tools/**`. Step 30 = core abstractions only (no concrete tool); Step 33 = leaf descriptors + non-core wiring + a test that no concrete tool is imported into `src/core` (`no-cross-layer-imports` stays green). |

Codex round-3 verdict: all round-2 residuals RESOLVED; trust model YES-WITH-CHANGES (the one change was placement, now applied); recommendation apply-listed-changes-then-author. The listed change is applied above; the plan is ready for §I ratification then step authoring.

Unchanged invariants reaffirmed: topo-sort removed; no forbidden vocabulary (README lint); no CLAUDE.md hard rule weakened (`--redact` hard-bound, `read_only`+`project_ref` injected, `execute_sql` denied + no descriptor, allowlist verbatim + descriptor source, no raw secret in trace/digests/reject artifacts); `loopFactory` injected (no circular dep, fake-runner seam preserved); **`src/core` import-clean — concrete tools in leaf folders, registration in `src/cli`**; max two options per decision; no new scope beyond closing review findings.
