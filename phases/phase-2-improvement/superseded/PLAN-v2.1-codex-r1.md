# Phase 3 — Agentic Veyra (PLAN-v2.1: agentic-loop foundation, codex round-1 revision)

**Status:** revision of PLAN-v2 incorporating codex round-1 (YES-WITH-CHANGES). Supersedes `superseded/PLAN-v1-deterministic.md` + `superseded/PLAN-v2-pre-codex.md`. Topo-sort orchestrator removed, not preserved.
**Date:** 2026-05-27
**Reviewer:** codex (3 rounds — round 1 returned YES-WITH-CHANGES: 5 MUST-fix + 3 SHOULD-consider; this is the round-2 submission).
**Theme of this revision (codex's words):** *make the deterministic-floor preservation mechanically testable.* Every "the floor still owns X" claim is now backed by a schema that makes the violation un-representable plus a named test, not prose.

The load-bearing inversion: **the agentic loop is the orchestrator.** AI proposes the next tool call; a deterministic policy gate authorizes it; a deterministic tool executes it; the result is written to the artifact store; the loop repeats until a deterministic termination condition fires. AI never produces a Finding, never classifies, never decides cleanup, never holds a raw secret, never writes outside an allowlist. Those are the deterministic floor, relocated — no longer the *orchestrator*, now *predicates the loop's output flows through*.

## §A. Diagnosis — 10 Observations under agentic framing

| Obs | Classification | Why |
|---|---|---|
| 1 universal 12 controls | FUNDAMENTAL — resolved | Loop reasons over artifacts and decides what to probe; control list no longer iterated. |
| 2 AI segregated | FUNDAMENTAL — resolved by inversion (NOT by letting AI author findings) | AI moves to center as decision-maker about what to check; still never classifies. |
| 3 test types catalog-bound | FUNDAMENTAL — resolved with safety floor | Directive 1: AI authors request method/URL/body within per-primitive `requestSchema`; catalog → typed probe primitives with cleanup contracts. |
| 4 operator inputs over-specified | SURFACE — partial | Loop can call discover-actors tool; manifest stays default unless ratified. |
| 5 regex parser | ACCEPTABLE-TRADEOFF | Parser becomes `read-schema` tool; brittleness bounded + disclosed in `uncertainty_notes`. |
| 6 per-control report | SURFACE (downstream) | Narrative renders above cards; deterministic-render mechanism inherited from PLAN-v1 §D.A. |
| 7 templated coverage gaps | SURFACE | Gap = loop terminated without required evidence X (§K ledger); context emergent from loop log. |
| 8 deterministic classification | ACCEPTABLE-TRADEOFF — preserved, now schema-enforced | In-loop tool-result schemas FORBID classification fields (§D.2, Step 35). |
| 9 19 CLI flags | SURFACE — partial | AI-tuning flags collapse into `--loop-budget`; full inference deferred. |
| 10 bolt-on pattern | PROCESS — closed by this cycle | Inverting the foundation is the only honest answer. |

## §B. Agentic loop architecture (chosen)

`src/core/orchestrator/agentic-loop.ts` replaces `scan-orchestrator.ts` as runtime entry.

```
run(context, toolCatalog, policy, aiDriver, budget):
  state  = ArtifactState(context.artifactDir)        # append-only
  ledger = RequiredEvidenceLedger(policy, toolCatalog)  # §K named contract; deterministic
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
    gate = policyGate.authorize(tool, proposal.args, policy, state)   # inner loop, deterministic
    if not gate.allowed: state.recordDenial(tool.id, gate.reason); continue
    parsed = tool.schema.safeParse(proposal.args)
    if not parsed.ok: state.recordArgReject(...); continue
    t0 = clock()                                       # per-tool failure boundary (codex MUST #1)
    try:
      result = await tool.invoke(parsed.value, context, policy)   # Result<T,E>, redacts before persist
      state.writeToolResult(tool.id, result, digest=sha256(result), duration=clock()-t0)
    except cause:
      state.recordToolError(tool.id, error_class=cause.constructor.name, duration=clock()-t0)
      continue                                         # NO rethrow; floor still runs
  # deterministic floor AFTER the loop:
  facts     = collectFacts(state)                     # facts/outcomes only — NEVER carry finding_type
  findings  = runClassificationPredicates(facts, ledger.gaps(state))  # SOLE Finding producer (Obs 8)
  cleanup   = runCleanupPhase(state.writeRegistry, state.adminRegistry)   # both write paths, §D.3
  narrative = renderNarrative(claimLinter(narrativeAuthor(findings, state)))
  report    = render(findings, narrative, cleanup, state.loopLog)
```

Runner-up: ReAct free-text scratchpad — rejected (un-gateable, regex-parse brittleness, unprovable audit). Tradeoff: lower expressive ceiling vs provable gate+audit; a security tool needs provable.

**Per-tool failure boundary (codex MUST #1).** Today `scan-orchestrator.ts:329` (`runOne`) catches each agent throw, emits a `coverage_gap` (`:185` `coverageGapFor`), writes an error artifact (`:203`), continues. PLAN-v2 dropped this; PLAN-v2.1 **relocates the same boundary into the loop body**: each `tool.invoke` wrapped in a deterministic `try`; a throw records a `tool_error` fact + artifact (`error_class`, `tool_id`, `args_redacted`, `duration`), never rethrows, loop proceeds. The floor always runs; an errored tool produces no facts, so the §K ledger turns its missing baseline evidence into a floor `coverage_gap`. One tool crashing cannot corrupt append-only state or block other calls. Step 31 owns; Step 41 asserts (throwing tool → loop continues, `tool_error` artifact, floor still produces findings + cleanup).

Tool catalog: registry of `ToolDescriptor {tool_id: ToolId, title, args_schema (Zod), result_schema (Zod), required_action: AllowedAction, invoke}`. AI sees only `descriptors()`. One folder per family; no central switch (FPP §2A). `ToolId` opaque branded.

Termination (deterministic): (a) AI `done`; (b) budget cap; (c) no-progress stall; (d) loop-driver hard error. All four: floor runs, §K ledger evaluated.

## §C. Tool catalog design

- **Scanners** → `run-gitleaks`/`run-osv`/`run-semgrep`, `required_action: read_scanner_logs`, adapters unchanged. Gitleaks descriptor hard-binds `--redact` (not a schema field; cannot express non-redacted call).
- **MCP calls** → ONE tool per allowlisted method. **Descriptor universe derived mechanically from `SUPABASE_ALLOWLIST` (`policy.ts:38`) + Lovable allowlist** — no hand-list. `execute_sql` ∈ `DENIED_TOOLS` (`:50`), ∉ allowlist ⇒ no descriptor ⇒ AI cannot name it. `checkInvocation` (`:71`) + `SupabaseClient.invoke` (`client.ts:97`) remain invoke-time defense-in-depth. §D.5 + Step 33 + tests.
- **Existing agents** → DECOMPOSED into tools (read/parse → tools; classify → floor). Preserves Obs 8. Runner-up: whole-agent-as-tool — rejected (reburies Obs 1/2).
- **Sandbox-runner 13 catalog entries** → composable probe primitives. Outcome-assertion logic → deterministic floor classifier; request shape AI-authored within `requestSchema`; executed via `executeWriteWithRegistry()`.
- **read-file / read-schema** → first-class tools; `read-file` is `read_code`, path-traversal-guarded in the tool.

**Tool result schemas carry no classification (codex MUST #2).** Shared in-loop `ToolResult` base type (`src/types/tool-result.ts`, new) makes keys `finding_type`/`review_action`/`evidence_strength`/`blast_radius`/`reproducibility` **not assignable** (exact object shape + `Exclude` guard); `result_schema` uses `.strict()` so an unknown classification key fails `safeParse`. Step 35 is the sole `Finding` constructor. Tests in §D.2.

## §D. Trust-model amendments

1. **AI never produces a Finding** → SURVIVES VERBATIM, schema-enforced. In-loop `ToolResult` makes classification keys un-assignable; post-loop predicate layer is sole `Finding` importer. Test (35): `@ts-expect-error` a `ToolResult` with `finding_type` doesn't compile + `.strict()` runtime reject.
2. **AI never sets classification** → SURVIVES VERBATIM, schema-enforced. Relocation of `predicates.ts:179/395` (`finding_type` inline today) + `agent.ts:773` (`allFindings` assembled inline): fact-extraction half → in-loop tool results; classification half → Step 35 floor. Test: structural test that no `src/core/orchestrator/` or `*-tool.ts` file imports `Finding`.
3. **AI never decides cleanup** → REBALANCED **[RATIFY]**. AI authors writes (Directive 1); cleanup grows to cover both write paths (§D.3). AI cannot skip/defer/scope cleanup.
4. **AI never holds raw secrets** → SURVIVES + ADDITION. Tool results re-entering loop view redacted (stable-alias, PLAN-v1 §D.C) before AI sees them. Trace logs `result_digest` (sha256 of *redacted* result) + `alias_map` ref, never raw.
5. **AI never writes MCP outside allowlist** → SURVIVES, structurally stronger. No descriptor for non-allowlisted method (descriptors derive from allowlist); gate re-checks; `checkInvocation` denies at connector.
6. **AI never calls Supabase MCP without read_only+project_ref** → SURVIVES VERBATIM. Tool builds the invocation; `checkInvocation`/`invoke` (`client.ts:97`) inject `read_only=true`+`project_ref`, reject reserved keys, unchanged.

Net: 5 survive (2 now schema-enforced), 1 rebalances (#3, ratify).

**§D.3 — both write paths named (codex MUST #4).**
- **Path 1 — HTTP transport.** `sandbox-runner/agent.ts:155` builds AI/compiler-shaped `method/url/headers/body` → `input.transport.send()`. PLAN-v2.1: every state-changing HTTP send routes through `executeWriteWithRegistry()`, recording `{method, url, redacted_body, reversal_hint}` to `http-write-registry` *before* send; **sole** write entry. Direct mutating `fetch()`/`transport.send()` outside the wrapper = lint-blocking failure (Step 38).
- **Path 2 — Admin SDK synthetic resources.** `synthetic-data-manager/agent.ts:111` (`runSynthesizePhase`) creates synthetic users via `input.admin.createSyntheticUser`, own registry + `rollback` + `runCleanupPhase` reverse-walk (already split per codex retro 2.06). PLAN-v2.1 **keeps** this registry, **unifies** it under one `WriteRegistry` contract so post-loop cleanup reads *both* and produces one `cleanup_proof`/`residual_count`. Does not rewrite Admin creation logic. Cleanup failure on either path → `cleanup_failed` launch-blocker (floor-emitted). Step 38 Done-When names both; Step 41 roundtrips both (1 HTTP write + 1 synthetic user, both reversed, `residual_count: 0`).

## §E. Termination + budget + fallback

Done: AI `{kind:'done', rationale}`; floor always runs; §K ledger evaluated (premature `done` → `early_done` + per-missing floor `coverage_gap`). Budget caps (three independent, first-trips-wins): `max_tool_calls` (~40), `max_wall_clock_ms` (~5 min), `max_ai_cost_units` (token-based); denials/rejects/tool-errors count; `max_steps` backstop. CLI override: `--loop-budget`.

**`--no-ai` plan-walker (codex MUST #5).** Deterministic plan-walker over the SAME catalog in fixed dependency order. Today deterministic planner (`ai-security-planner:94`) emits `parameters:{}`; compiler (`active-validation-policy-compiler:113/125`) requires `target` for every control except cc-11-1/2. So empty-arg walking can't supply write-probe targets. **Chosen option (b):** read-only tools full coverage under `--no-ai`; write probes needing an AI-authored target → floor `coverage_gap` ("active write-probe requires AI planning; re-run without `--no-ai`"). Runner-up (a) per-tool static arg providers — rejected: re-implements deterministically the target-selection the loop exists to provide = a second planning engine + a second determinism-drift surface, for the lowest-value highest-trust probes. Step 32: plan-walker + read-only parity test + write-probe-`coverage_gap` test.

## §F. Audit trail

`loop-trace.jsonl` — one JSON line per step (`ArtifactKind: loop_trace`). Fields (codex SHOULD #6 additions in **bold**):
`step, recorded_at, model_id, prompt_fingerprint_sha256, proposal_kind, tool_id?, args_redacted?, gate_decision, gate_reason?, arg_validation, invoke_status, result_artifact_ref?, budget_snapshot, **policy_snapshot_hash** (sha256 of {mode, sorted allowed_actions[]}), **descriptor_schema_version_hash** (sha256 of catalog descriptor set AI saw this step), **tool_duration_ms?**, **result_digest?** (sha256 of REDACTED result), **tool_error_class?**, **state_view_digest** (sha256 of readable view handed to AI), **alias_map_artifact_ref?**`.
`args_redacted`/`result_digest` over redacted data only (no raw secret). `policy_snapshot_hash` + `descriptor_schema_version_hash` prove which policy + tool universe were in force per decision. Append-only, per-step write (crash leaves complete record). Owned by Step 34.

## §G. Existing-work accounting

**REBUILD:** P1 18/18b (orchestrator → loop; salvage `hypothesis-disposition` into floor; **failure boundary `:185/329` salvaged, relocated to per-tool boundary**); P2 14 (two-phase → loop+floor; scan-actions-log → loop-trace; crash-cleanup preserved).
**DEPRECATE:** P1 08d (ai-inference); P2 09 (ai-explainer → narrative-author); P2 07b (ai-security-planner; its deterministic-fallback role → Step 32 plan-walker per §E(b)); P2 07c compiler guarantees (baseline+budget) → gate + §K ledger.
**AMEND:** P1 05b/06b/07b (scanners → descriptors); P1 15/16/24-27 (MCP/REST → per-method descriptors from allowlist, allowlist unchanged); P1 09b/10b/11b/12b (predicate classify → floor, read/parse → tools; the `predicates.ts`/`agent.ts:773` relocation §D.2); P1 08c (ContextPolicyEvaluator → gate); P2 06/06b (synthesize/manifest → tools; Admin registry kept+unified §D.3 Path 2); P2 07/07d (catalog → probe-primitive split); P2 08 (sandbox-runner → probe-http via `executeWriteWithRegistry` §D.3 Path 1 + deterministic classifier); P1 13/13b + P2 12 (reporter + narrative + loop-trace summary); P1 14/14b + P2 10e (floor classification + readiness rules); P2 10a-10d; P1 29 / P2 11 (CLI wires loop + `--loop-budget` + `--no-ai`); **NEW P1 03/03b CLI factory + registration (§G.1 + Step 40b).**
**KEEP AS-IS:** P1 02/02b (foundation types, artifact store, policy — extend ArtifactKind additively); P1 05/06/07 adapters, 02c/02d, 04/04b; `tool-policy.ts` `enforce()`; connector allowlist files (verbatim — now *also* descriptor source); P2 step 01 preventers 7+8; `validation-policy.ts`, `sanitization.ts`; `SupabaseClient.invoke`/`checkInvocation`.

**§G.1 — CLI factory + registration migration (codex SHOULD #8).** Ground truth: `scan-command.ts:13` imports `createScanOrchestrator`; `:19` `registerPhase1Agents`; `ScanCommandDeps.orchestratorFactory: () => ScanOrchestrator` (`:222`); `runScan` calls `deps.orchestratorFactory()` (`:791`) then `registerPhase1Agents(orchestrator,{...})` (`:935`); `defaultScanCommandDeps` wires `orchestratorFactory: createScanOrchestrator` (`:1228`); `registerPhase1Agents` at `agent-registration.ts:114` registers seven agents. Migration: `orchestratorFactory: () => ScanOrchestrator` → `loopFactory: () => AgenticLoop`; `registerPhase1Agents(orch)` → `registerTools(catalog)`; migrate every test import. **Step 40b** owns this. Done-When: no production import of `createScanOrchestrator`/`registerPhase1Agents`/`ScanOrchestrator` outside `superseded/`; structural test asserts; CLI `runScan` constructs the loop via new factory.

## §H. Steps (from 30)

| # | Title | Depends | Scope | Amends |
|---|---|---|---|---|
| 30 | Tool catalog registry + `ToolId` + descriptor contract (`args_schema`+`result_schema`) + in-loop `ToolResult` base forbidding classification keys (compile + `.strict()`) + dependency/registration test; extend ArtifactKind (`loop_trace`, `tool_error`, `required_evidence_ledger`, alias-map) additively | none | M | new |
| 31 | Agentic loop driver + policy gate inner step + budget caps + **per-tool failure boundary** | 30 | L | 18/18b REBUILD; salvage :185/329 |
| 32 | `--no-ai` plan-walker over same catalog + read-only parity test + **write-probe→`coverage_gap` test (§E b)** | 30, 31 | M | §E fallback; 07b replacement |
| 33 | Register read-only tools: scanners + MCP-read + read-file/read-schema. **MCP descriptors generated from allowlist** (gitleaks `--redact` hard-bound). Tests: (a) no generic call-mcp, (b) no `execute_sql` descriptor, (c) invoke-time denial fires | 30 | M | 05b/06b/07b, 15, 16, 24-27 |
| 34 | Loop-view redaction + audit trail with **all §F defensibility fields** | 31 | M | new |
| 35 | Deterministic floor: classification predicates over loop facts (SOLE Finding + SOLE classification). **Tests: in-loop `ToolResult` w/ `finding_type` doesn't typecheck; no orchestrator/`*-tool.ts` imports `Finding`** | 31, 33 | L | 09b/10b/11b/12b, 14/14b; relocate predicates.ts:179/395 + agent.ts:773 |
| 36 | Narrative author + claim-linter + deterministic renderer (carry PLAN-v1 §D.A) | 35 | L | 09 DEPRECATE |
| 37 | Reporter: narrative + per-control cards + loop-trace summary | 35, 36 | M | 13/13b, 12 |
| 38 | Unified write cleanup: `executeWriteWithRegistry()` SOLE HTTP write entry (**Path 1**) + keep/unify Admin-SDK registry (**Path 2**) under one `WriteRegistry` + post-loop reverse-walk over both + direct-write lint guard; cleanup failure either path → `cleanup_failed` launch-blocker | 31 | L | 06/06b, 08, 14, §D.3 |
| 39 | Probe-primitive split: per-primitive `requestSchema` + AI request authoring within bounds + outcome classifiers; all writes via Step 38 | 38, 35 | L | 07, 07b, 07c, 07d, 08, 10a-10d |
| 40 | Mode B CLI wiring: loop driver + `--loop-budget` + approval + `--no-ai` | 31, 32, 38, 40b | M | 29, 11 |
| 40b | **CLI factory + registration migration (§G.1)**: `orchestratorFactory`→`loopFactory`, `registerPhase1Agents`→`registerTools`, migrate test imports; structural test asserts no production orchestrator import outside `superseded/` | 31, 33 | M | new; 03/03b, 18/18b call sites |
| 41 | Fixture gate: agentic-flow e2e + determinism + write-then-cleanup roundtrip **across both paths** + trust-invariant assertions + **per-tool failure-boundary assertion** + **required-evidence-ledger assertion (early `done` → `coverage_gap` per missing item)** | 31-40b | L | 19/19b, 13, 15 |

Forward stub: Phase 4 placeholder for operator-surface reduction (Obs 9 remainder) + B.2-as-default reconsideration, status `not started`.

## §I. Decisions the user must make

1. **Cleanup-aware write authority (§D.3).** Ship write-authoring ONLY behind mandatory unified `WriteRegistry` (both paths) + reverse-walk + `cleanup_failed` launch-blocker, no bypass flag? (Planner: yes.)
2. **Mode B default (preventer 10).** Keep B.1 manifest default, or flip to auto-synthesize? (Planner: keep B.1 this phase.)
3. **Loop budget defaults.** `max_tool_calls`/`max_wall_clock_ms`/`max_ai_cost_units` shipped values — business call. (Planner: 40 / 5 min / token cap.)
4. **AI provider for loop driver.** Anthropic (wired) + OpenAI fallback, or fresh decision?
5. **`--no-ai` write-probe promise (§E).** Confirm option (b): read tools full coverage, write probes → `coverage_gap` offline. (Planner: yes.)

## §J. Decisions the planner picks

1. Typed-proposal discriminated union (vs ReAct free-text) — provable gate+audit.
2. Agents decomposed into tools (vs whole-agent-as-tool) — avoid reburying Obs 1/2.
3. One descriptor per allowlisted MCP method, **generated from allowlist** (vs generic call-mcp; vs hand-list) — allowlist stays single compile-time source.
4. `--no-ai` = plan-walker, write probes → `coverage_gap` (vs static arg providers) — avoid second determinism-drift surface.
5. Salvage classification into post-loop floor with **schema forbidding classification keys in-loop** (vs in-loop classify; vs prose) — mechanically preserve Obs 8.
6. Carry PLAN-v1 §D.A narrative + §D.F write-safety intact (vs redesign) — 3-round reviewed, never depended on topo-sort.
7. Per-tool failure boundary inside loop (vs whole-loop try) — preserve `scan-orchestrator.ts:329` failure isolation.

## §K. Trust-model risks + guardrails + required-evidence ledger

**Required-evidence ledger (named contract — codex SHOULD #7).** `RequiredEvidenceLedger` (`src/core/orchestrator/required-evidence-ledger.ts`, new; `ArtifactKind: required_evidence_ledger`) — deterministic, parameterized by `ValidationPolicy` + tool catalog. Typed table `{baseline_item_id, required_action, satisfied_by(state):boolean, gap_control_id}`. Baseline for `read_only_evidence`: schema-meta read, storage-meta read (or `coverage_gap` if no `StorageMetadataSource`), scanner triplet executed, code-read of declared surfaces. Mode B adds: actor session established, each declared probe attempted. Loop computes `ledger.baselineSatisfied(state)` at `done`; early `done` → `early_done` trace + one floor `coverage_gap` per `ledger.missing(state)` item citing the trace + baseline item. AI cannot suppress baseline coverage by terminating early. Step 41 asserts.

Risks: selection bias → ledger floor coverage_gap; premature termination → `early_done` + per-item gap; gate-denial gaming → counts vs budget, deterministic gate, repeated denial → stall_halt; prompt injection from tool outputs → no `execute_sql` descriptor, outputs redacted + framed as data, gate by descriptor not intent; cost/wall-clock runaway → three caps + max_steps; hallucinated params → Zod safeParse + `requestSchema` bounds; AI invents nonexistent tool → `unknown_tool`, no fallback exec; tool crash → per-tool boundary, `tool_error`, loop continues, floor+cleanup run; write-cleanup hole → `executeWriteWithRegistry` sole HTTP entry + Admin registry unified + direct-write lint failure + `cleanup_failed` launch-blocker.

## §L. Sequencing

- **Cut 1 (minimum first-shippable):** 30, 31, 32, 33, 34, 35, 40b, 41-partial. Full agentic flow over read-only tools; deterministic floor; `--no-ai` parity; audit with defensibility fields; per-tool failure boundary; CLI migrated to loop factory. Near-zero new trust surface (no writes). (40b in Cut 1 — CLI can't call the loop without it.)
- **Cut 2:** 36, 37. Narrative reframe. Independent of writes.
- **Cut 3:** 38, 39, 40, 41-complete. Mode B AI-authored writes + unified registry (both paths) + cleanup roundtrip. Highest trust surface; ships last.

## §M. README update plan

Lands after §I ratification + step files pass codex, before code merges; own codex pass.

1. What Veyra is — agentic analyzer bounded by deterministic gate + floor.
2. How a scan works — loop in plain language.
3. Trust boundaries — six invariants; gate + floor deterministic; classification + cleanup never AI-decided.
4. Trust-mode matrix:

| Mode | Credential ask | What AI may author | Writes? | Cleanup | `--no-ai` |
|---|---|---|---|---|---|
| A | project path; optional read-only MCP | which read tools, in what order | none | n/a | static plan-walker, full Findings |
| B.1 | sandbox + declared actors | read tools + probe request shapes within `requestSchema` | yes, registry-tracked (HTTP + Admin) | deterministic reverse-walk over both, `residual_count: 0` | read tools full Findings; write probes → `coverage_gap` |
| B.2 | + service-role key | + actor synthesis | yes, registry-tracked (HTTP + Admin) | deterministic, mandatory on crash, both registries | read tools full Findings; write probes → `coverage_gap` |
| C | reserved | reserved | reserved | reserved | reserved |

5. Audit — `loop-trace.jsonl` reconstruction; policy/descriptor snapshot hashes prove what was in force per decision.
6. Allowed-claims note — never secure/safe/compliant; whole README through `output-language-lint`.

## §N. Disposition of codex round-1 findings

| # | Finding | Disposition |
|---|---|---|
| 1 | [MUST] loop omits per-agent failure boundary | APPLIED — §B per-tool try → `tool_error` fact+artifact, never rethrows, floor runs; Step 31 owns, Step 41 asserts; new `ArtifactKind: tool_error` |
| 2 | [MUST] "floor sole Finding producer" not yet true | APPLIED-mechanical — in-loop `ToolResult` forbids classification keys (exact shape + `Exclude` + `.strict()`); Step 35 sole `Finding` constructor; `@ts-expect-error` + structural import test |
| 3 | [MUST] "no descriptor for denied MCP" is new behavior | APPLIED-mechanical — MCP descriptors generated from `SUPABASE_ALLOWLIST`+Lovable allowlist; `execute_sql` no descriptor; tests (a)/(b)/(c); invoke-time denial retained |
| 4 | [MUST] cleanup rebalance under-scoped | APPLIED — §D.3 names Path 1 (`HttpTransport.send`→`executeWriteWithRegistry`) + Path 2 (Admin registry kept+unified under `WriteRegistry`); Step 38 both, Step 41 roundtrips both |
| 5 | [MUST] `--no-ai` can't do "same probes full Findings" | APPLIED + SURFACED — §E option (b): read full, write→`coverage_gap`; §I decision 5 ratification |
| 6 | [SHOULD] audit trace missing defensibility fields | APPLIED — §F adds 7 fields; Step 34; over redacted data only |
| 7 | [SHOULD] premature `done` needs required-evidence ledger | APPLIED — §K `RequiredEvidenceLedger` typed contract + artifact; early `done` → `coverage_gap` per missing; Step 41 asserts |
| 8 | [SHOULD] accounting must name call-site migration | APPLIED — §G.1 names every site; Step 40b; structural test; moved to Cut 1 |

Unchanged invariants reaffirmed: topo-sort stays removed; no forbidden vocabulary (README through `output-language-lint`); no CLAUDE.md hard rule weakened (`--redact` hard-bound, `read_only`+`project_ref` injected by tool, `execute_sql` denied + no descriptor, allowlist files verbatim + promoted to descriptor source, no raw secret in trace/digests); max two options per decision throughout.
