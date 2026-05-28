# Phase 3 — Agentic Veyra (PLAN-v2: agentic-loop foundation)

**Status:** fresh planning cycle, supersedes `superseded/PLAN-v1-deterministic.md`. Topo-sort orchestrator is removed, not preserved.
**Date:** 2026-05-27
**Reviewer:** codex (3 fresh rounds — round 1 pending)
**Binding inputs:** PROBLEMS.md (10 Observations + Evidence appendix), CLAUDE.md hard rules, FPP §2A/§10/§12/§17/§18, product-owner directives 1–4 (2026-05-26).

The load-bearing inversion: **the agentic loop is the orchestrator.** AI proposes the next tool call; a deterministic policy gate authorizes it; a deterministic tool executes it; the result is written to the artifact store; the loop repeats until a deterministic termination condition fires. AI never produces a Finding, never classifies, never decides cleanup, never holds a raw secret, never writes outside an allowlist. Those are the deterministic floor, relocated — no longer the *orchestrator*, now *predicates the loop's output flows through*.

## §A. Diagnosis — 10 Observations under agentic framing

| Obs | Classification | Why |
|---|---|---|
| 1 universal 12 controls | FUNDAMENTAL — resolved | Loop reasons over artifacts and decides what to probe; control list is no longer iterated. |
| 2 AI segregated | FUNDAMENTAL — resolved by inversion (NOT by letting AI author findings) | AI moves to center as decision-maker about what to check; still never classifies. |
| 3 test types catalog-bound | FUNDAMENTAL — resolved with safety floor | Directive 1: AI authors request method/URL/body; catalog becomes typed probe primitives with cleanup contracts. |
| 4 operator inputs over-specified | SURFACE — partial | Loop can call discover-actors tool; manifest stays default unless ratified. |
| 5 regex parser | ACCEPTABLE-TRADEOFF | Parser becomes a `read-schema` tool; brittleness bounded + disclosed. |
| 6 per-control report | SURFACE (downstream) | Narrative section renders above cards once loop produces richer artifacts; deterministic-render mechanism inherited from PLAN-v1 §D.A. |
| 7 templated coverage gaps | SURFACE | Gap = loop terminated without evidence X; context emergent from loop log. |
| 8 deterministic classification | ACCEPTABLE-TRADEOFF — preserved deliberately | The floor that MUST survive; classification predicates consume loop facts exactly as topo-sort facts. |
| 9 19 CLI flags | SURFACE — partial | AI-tuning flags collapse into one `--loop-budget`; full flag inference deferred. |
| 10 bolt-on pattern | PROCESS — closed by this cycle | Inverting the foundation is the only honest answer. |

## §B. Agentic loop architecture (chosen)

`src/core/orchestrator/agentic-loop.ts` replaces `scan-orchestrator.ts`. Sequence:

```
run(context, toolCatalog, policy, aiDriver, budget):
  state = ArtifactState(context.artifactDir)        # append-only
  step = 0
  while true:
    step += 1
    proposal = aiDriver.proposeNext(state.readableView(), toolCatalog.descriptors())
      # typed union: {kind:'invoke_tool', tool_id, args} | {kind:'done', rationale}
    logStep(step, prompt_fingerprint_sha256, model_id, proposal)
    if proposal.kind=='done': record done; break
    if budget.exceeded(...): record budget_halt; break
    if state.noProgress(window): record stall_halt; break
    tool = toolCatalog.resolve(proposal.tool_id)      # registry lookup; no central switch
    if tool is None: record unknown_tool; continue
    gate = policyGate.authorize(tool, proposal.args, policy, state)   # inner loop, deterministic
    if not gate.allowed: state.recordDenial(tool.id, gate.reason); continue
    parsed = tool.schema.safeParse(proposal.args)
    if not parsed.ok: state.recordArgReject(...); continue
    result = await tool.invoke(parsed.value, context, policy)   # Result<T,E>, redacts before persist
    state.writeToolResult(tool.id, result)
  # deterministic floor AFTER the loop:
  facts = collectFacts(state)
  findings = runClassificationPredicates(facts)       # SOLE Finding producer (Obs 8)
  cleanup = runCleanupPhase(state.writeRegistry)       # deterministic, mandatory
  narrative = renderNarrative(claimLinter(narrativeAuthor(findings, state)))
  report = render(findings, narrative, cleanup, state.loopLog)
```

Runner-up: ReAct free-text scratchpad — rejected (free-text actions un-gateable, reintroduce regex-parse brittleness, audit unprovable). Tradeoff: lower expressive ceiling vs provable gate+audit; security tool needs provable.

Tool catalog: registry of `ToolDescriptor {tool_id: ToolId, title, args_schema (Zod), required_action: AllowedAction, invoke}`. AI sees only `descriptors()` (never `invoke`). One folder per tool family; no central switch (FPP §2A). `ToolId` opaque branded.

Termination (deterministic, AI cannot suppress): (a) AI `done`; (b) budget cap; (c) no-progress stall; (d) loop-driver hard error.

## §C. Tool catalog design

- **Scanners** → `run-gitleaks` / `run-osv` / `run-semgrep`, `required_action: read_scanner_logs`, adapters unchanged. Gitleaks descriptor hard-binds `--redact` (cannot express non-redacted call).
- **MCP calls** → ONE tool per currently-allowlisted method (`read-schema-meta`, `read-storage-meta`, `read-file`, `list-files`, `get-diff`, ...). NOT a generic call-mcp. No descriptor exists for any denied method, so AI cannot name `execute_sql`. Supabase tools pass `read_only=true + project_ref` via existing `checkInvocation`.
- **Existing agents** → DECOMPOSED into tools (read/parse become tools; classify leaves the loop, joins deterministic floor). Preserves Obs 8. Runner-up: wrap whole-agent-as-tool — rejected (reburies Obs 1/2).
- **Sandbox-runner 13 catalog entries** → composable probe primitives. Outcome-assertion logic stays deterministic (becomes a classifier); request shape AI-authored within per-primitive `requestSchema`; executed via `executeWriteWithRegistry()`.
- **read-file / read-schema** → first-class tools; `read-file` is `read_code`, path-traversal-guarded in the tool.

## §D. Trust-model amendments

1. **AI never produces a Finding** → SURVIVES VERBATIM. Findings produced by floor classification predicates over loop facts.
2. **AI never sets classification** → SURVIVES VERBATIM. Predicates deterministic, outside loop; proposal schema has no `finding_type`.
3. **AI never decides cleanup** → REBALANCED **[RATIFY]**. AI now authors writes (Directive 1); cleanup floor grows: new deterministic `http-write-registry` records every state-changing call; cleanup reverses each. AI cannot skip/defer/scope cleanup.
4. **AI never holds raw secrets** → SURVIVES + ADDITION. Tool results re-entering the loop view are redacted (stable-alias, PLAN-v1 §D.C carried) before AI sees them. Strengthening, not new authority.
5. **AI never writes MCP outside allowlist** → SURVIVES, structurally stronger. No descriptor for non-allowlisted methods; gate re-checks at invoke.
6. **AI never calls Supabase MCP without read_only+project_ref** → SURVIVES VERBATIM. Tool builds the invocation, not AI; `checkInvocation` unchanged.

Net: 5 survive, 1 rebalances (#3, ratify).

## §E. Termination + budget + fallback

Done signal: AI emits `{kind:'done', rationale}`; floor always runs after, regardless of how loop ended. Budget caps (three independent, first-trips-wins): `max_tool_calls` (default ~40), `max_wall_clock_ms` (~5 min), `max_ai_cost_units` (token-based); denials/arg-rejects count too; `max_steps` backstop. CLI-overridable under one `--loop-budget`.

`--no-ai` = deterministic **plan-walker** over the SAME tool catalog in fixed dependency order (the old topo-sort order as a static tool list). Full read-only Findings + descriptive narrative, no AI cost. Loop and plan-walker share the same catalog + same deterministic floor; only the driver differs. This keeps `--no-ai` a first-class product, not a stub.

## §F. Audit trail

`loop-trace.jsonl` — one JSON line per step (new `ArtifactKind: loop_trace`): `{step, recorded_at, model_id, prompt_fingerprint_sha256, proposal_kind, tool_id?, args_redacted?, gate_decision, gate_reason?, arg_validation, invoke_status, result_artifact_ref?, budget_snapshot}`. `args_redacted` through stable-alias redaction (no raw secret). `prompt_fingerprint_sha256` = hash of (system + serialized loop-view). Append-only, written per-step (crash leaves complete record up to crash). Operator reconstructs every AI decision top-to-bottom.

## §G. Existing-work accounting

**REBUILD:** P1 18/18b (orchestrator → loop; salvage `hypothesis-disposition` into floor); P2 14 (two-phase → loop+floor; scan-actions-log merges into loop-trace; crash-cleanup preserved).
**DEPRECATE:** P1 08d (ai-inference — loop is inference layer); P2 09 (ai-explainer — merges into narrative-author); P2 07b (ai-security-planner — loop does its job); P2 07c compiler's *guarantees* (baseline+budget) move into gate.
**AMEND:** P1 05b/06b/07b (scanners → tool descriptors); P1 15/16/24-27 (MCP/REST → per-method tool descriptors, allowlist unchanged); P1 09b/10b/11b/12b (predicate classify → floor, read/parse → tools); P1 08c (ContextPolicyEvaluator → unify into gate); P2 06/06b (synthesize/manifest → tools; cleanup grows); P2 07/07d (catalog → probe-primitive split); P2 08 (sandbox-runner → probe-http tool + deterministic classifier); P1 13/13b + P2 12 (reporter + narrative + loop-trace summary); P1 14/14b + P2 10e (floor classification + readiness rules); P2 10a-10d; P1 29 / P2 11 (CLI wires loop + --loop-budget + --no-ai plan-walker).
**KEEP AS-IS:** P1 02/02b (foundation types, artifact store, policy — extend ArtifactKind additively); P1 05/06/07 (scanner adapters), 02c/02d (AI provider types/Anthropic adapter), 04/04b (fixture); `tool-policy.ts` `enforce()` (gate core); connector allowlist files (verbatim); P2 step 01 preventers 7+8; `validation-policy.ts`, `sanitization.ts`.

## §H. Steps (from 30)

| # | Title | Depends | Scope | Amends |
|---|---|---|---|---|
| 30 | Tool catalog registry + `ToolId` + descriptor contract + dependency/registration test; extend ArtifactKind (`loop_trace`, alias-map) additively | none | M | new |
| 31 | Agentic loop driver + policy gate as inner step + budget caps | 30 | L | 18/18b REBUILD |
| 32 | `--no-ai` deterministic plan-walker over same catalog + parity test | 30, 31 | M | §E fallback |
| 33 | Register read-only tools: scanners + MCP-read + read-file/read-schema (allowlist + read_only unchanged; gitleaks --redact hard-bound) | 30 | M | 05b/06b/07b, 15, 16, 24-27 |
| 34 | Loop-view redaction + audit trail (`loop-trace.jsonl`) | 31 | M | new §D.4/§F |
| 35 | Deterministic floor: classification predicates over loop facts (sole Finding producer + sole classification site) | 31, 33 | L | 09b/10b/11b/12b, 14/14b |
| 36 | Narrative author + claim-linter + deterministic renderer (carry PLAN-v1 §D.A) | 35 | L | 09 DEPRECATE |
| 37 | Reporter: narrative section + per-control cards + loop-trace summary | 35, 36 | M | 13/13b, 12 |
| 38 | HTTP write registry + `executeWriteWithRegistry()` + cleanup reverse-walk + direct-write lint guard; cleanup failure → `cleanup_failed` launch-blocker | 31 | L | 06/06b, 14 |
| 39 | Probe-primitive split: per-primitive `requestSchema` + AI request authoring within bounds + outcome classifiers | 38, 35 | L | 07, 07b, 07c, 07d, 08, 10a-10d |
| 40 | Mode B CLI wiring: loop driver + `--loop-budget` + approval + `--no-ai` integration | 31, 32, 38 | M | 29, 11 |
| 41 | Fixture gate: agentic-flow e2e + determinism + write-then-cleanup roundtrip + trust-invariant assertions | 31-40 | L | 19/19b, 13, 15 |

Forward stub: Phase 4 placeholder for operator-surface reduction (Obs 9 remainder) + B.2-as-default reconsideration, status `not started`.

## §I. Decisions the user must make

1. **Cleanup-aware write authority (§D.3).** Ship write-authoring ONLY behind mandatory `http-write-registry` + reverse-walk + `cleanup_failed` launch-blocker, no bypass flag? (Planner: yes — only safe way.)
2. **Mode B default (preventer 10).** Keep B.1 manifest default, or flip to auto-synthesize now the loop can drive it? (Planner: keep B.1 this phase.)
3. **Loop budget defaults.** `max_tool_calls` / `max_wall_clock_ms` / `max_ai_cost_units` shipped values — business call. (Planner proposes 40 / 5 min / token cap.)
4. **AI provider for the loop driver.** Anthropic (already wired) + OpenAI fallback, or fresh decision?

## §J. Decisions the planner picks

1. Typed-proposal discriminated union (vs ReAct free-text) — provable gate+audit.
2. Agents → decomposed into tools (vs whole-agent-as-tool) — avoid reburying Obs 1/2.
3. One descriptor per allowlisted MCP method (vs generic call-mcp) — allowlist stays compile-time.
4. `--no-ai` = plan-walker over same catalog (vs divergent code path) — avoid second-path rot.
5. Salvage classification into post-loop floor (vs in-loop classify) — preserve Obs 8 determinism.
6. Carry PLAN-v1 §D.A narrative + §D.F write-safety intact (vs redesign) — already 3-round reviewed, never depended on topo-sort.

## §K. Trust-model risks of agentic + guardrails

- **Selection bias (what NOT to check):** mandatory-baseline rule enforced by floor AFTER loop; un-collected baseline → `coverage_gap` citing loop trace. AI cannot suppress.
- **Premature termination:** `done` doesn't skip floor; baseline coverage checked regardless; `min_tool_calls`-before-`done` guard logged as `early_done`.
- **Gate-denial gaming:** denials count vs budget; gate deterministic on `(tool_id, args-schema, required_action)` — no phrasing flips deny→allow; repeated same-tool denial → `stall_halt`.
- **Prompt injection from tool outputs:** no `execute_sql` descriptor to call; outputs redacted + framed as data; gate authorizes by descriptor not stated intent.
- **Cost/wall-clock runaway:** three budget caps, checked every step, denials/rejects count, `max_steps` backstop.
- **Hallucinated params:** Zod safeParse before invoke; reject logged + counts vs budget; URL/body bounded by `requestSchema`.
- **AI invents nonexistent tool:** `resolve` undefined → `unknown_tool` logged, counts vs budget, no fallback exec.
- **Write-cleanup hole:** `executeWriteWithRegistry()` sole write entry point; direct `fetch()` write = lint-blocking failure; cleanup failure → `cleanup_failed` launch-blocker.

## §L. Sequencing

- **Cut 1 (minimum first-shippable):** steps 30, 31, 32, 33, 34, 35, 41-partial. Full agentic flow against read-only tools; deterministic floor; `--no-ai` parity; audit trail. Near-zero new trust surface (no writes). Proves "agentic + trust preserved" cheaply.
- **Cut 2:** steps 36, 37. Narrative reframe. Independent of writes.
- **Cut 3:** steps 38, 39, 40, 41-complete. Mode B AI-authored writes + registry + cleanup roundtrip. Highest trust surface; ships last; a broken Cut 3 must not take down Cut 1.

## §M. README update plan

Lands after §I ratification + step files pass codex, before code merges; own codex pass (not against plan's 3-round budget).

1. What Veyra is — agentic analyzer; AI reasons about your app to decide what to check, bounded by deterministic gate + deterministic classification floor.
2. How a scan works — loop in plain language.
3. Trust boundaries — four invariants in plain English; gate + floor deterministic.
4. Trust-mode matrix:

| Mode | Credential ask | What AI may author | Writes? | Cleanup | `--no-ai` |
|---|---|---|---|---|---|
| A | project path; optional read-only MCP | which read tools, in what order | none | n/a | static plan-walker, full Findings |
| B.1 | sandbox + declared actors | read tools + probe request shapes within `requestSchema` | yes, registry-tracked | deterministic reverse-walk, `residual_count: 0` | plan-walker over same probes |
| B.2 | + service-role key | + actor synthesis | yes, registry-tracked | deterministic, mandatory on crash | plan-walker |
| C | reserved | reserved | reserved | reserved | reserved |

5. Audit — `loop-trace.jsonl` reconstruction.
6. Allowed-claims note — never secure/safe/compliant; whole README through `output-language-lint`.

Changes from PLAN-v1 README: frames around "AI drives collection via gated loop; determinism floors classification + cleanup" instead of "AI authors narrative over deterministic-collected evidence." Matrix gains "what AI may author" + `--no-ai` columns.
