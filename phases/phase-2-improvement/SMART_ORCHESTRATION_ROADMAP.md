# Smart Orchestration Roadmap — Phase 2 Improvement

**Status:** draft — not yet committed
**Maps to:** `phases/phase-2-improvement/PLAN.md` §B (loop is the orchestrator), §D.1–D.3 (boundaries), §G (existing-work accounting), §J (planner-picked decisions), §K (required-evidence ledger), §O (deep-dive sub-agents); `phases/FINAL_PRODUCT_PLAN.md` §2A (opaque IDs), §11 (control catalog); `CLAUDE.md` §MCP discipline, §Validation policy, §Secrets, §Scope discipline.

---

## Goal

Close the operator-named gap: the AI driver today sees `LoopView.steps` + `LoopView.facts` + `descriptors` and picks the next tool from a menu — that is **scheduling, not orchestration**. Smart orchestration means the AI receives (a) a deterministically-synthesized **project briefing** (app type, roles, sensitive tables, dependency surface, trust boundaries), (b) a **control-by-control threat-model priming** that names what's already evidenced vs. residual-risk, (c) an iterative **hypothesis registry** the AI authors and pursues across iterations, and (d) a **prioritized proposal** with auditable rationale. The end-state is: the AI knows what app it is looking at, knows which controls have residual risk, holds open hypotheses across iterations, and proposes the probe that most reduces residual risk — all bounded by the existing gate / floor / `WriteRegistry` / `RequiredEvidenceLedger` / spawn-gate stack. No new control_ids; no new trust surface beyond R3's narrow Mode-B-only carve-out.

---

## Decisions taken

### R1 — Phase 2 reasoning agents: revive or replace?

**Picked: (c) hybrid — `ai-product-understanding` revived as an AI-assisted pre-loop briefing step (with recorded-fixture determinism); `ai-inference` replaced by an in-loop hypothesis tool the AI calls (`propose-hypothesis` / `update-hypothesis`).**
**Runner-up:** (a) revive all four agents as pre-loop steps.
**Tradeoff:** The briefing is *one-shot synthesis from inventory* — pre-loop fits it, runs once per scan, and reuses the existing `src/agents/ai-product-understanding/agent.ts` shape (its `INTENT_RESPONSE_SCHEMA` already covers purpose/roles/data-kinds/auth-model). Hypothesis authoring is *iterative*, must mutate across loop steps, must be visible in `loop-trace.jsonl`, and must be gated by `tool-policy.ts` like any other AI action — that lives inside the loop as a tool, not outside it. `ai-security-planner` and `ai-explainer` are NOT revived: the loop + Step 36 narrative-author already cover their roles.

**Codex disposition [APPLIED — SO-R1-DETERMINISM-DRIFT]:** the briefing is renamed "**AI-assisted with recorded-fixture determinism**" — NOT "deterministic." Verification uses the recorded-fixture replay pattern from Step 31b (the Bedrock transport replays a pre-captured response under `VEYRA_BEDROCK_RECORDING=<path>`, byte-identical across runs). A `--no-ai` fallback produces a **structural-only briefing** (no AI call; inferences come from inventory + schema + lockfile shape alone, no purpose/roles synthesis). The `--no-ai` path's briefing is genuinely deterministic; the AI path's "determinism" is replay-determinism.

### R2 — Hypothesis state: in `view`, in a separate registry, or as ScanFacts?

**Picked: (c) separate `HypothesisRegistry`, surfaced through `LoopView` as a read-only projection `view.hypotheses`.**
**Runner-up:** (b) ScanFacts with a new `ScanFactSource.kind = 'hypothesis'` variant.
**Tradeoff:** Hypotheses are AI-mutable state with a lifecycle (`open` / `confirmed` / `refuted` / `inconclusive`); facts are immutable accepted tool results. Mixing them into the fact stream would re-open the §D.1 result-parse-or-reject boundary the floor depends on. A separate registry (closure-injected like `WriteRegistry` per Step 40c-v3 Decision F) keeps facts pure, lets the loop project a read-only view for the AI, and gives Step 34's audit trail a natural per-hypothesis event row. `LoopView` gets one new read-only field (`readonly hypotheses: readonly HypothesisProjection[]`); the AI mutates state only through the `propose-hypothesis` / `update-hypothesis` tool descriptors, which means hypothesis writes pass through `tool-policy.ts` like every other AI action. `src/types/hypothesis.ts` exists already and stays as the shape source; the loop-side projection is a redaction-safe subset of it.

**Codex disposition [APPLIED — SO-R2-PREWRITE-GUARD]:** `result_schema` parses the tool's RETURN value, but registry writes happen INSIDE `tool.invoke` BEFORE that parse — so the existing §D.1 boundary alone cannot prevent the AI from smuggling classification keys (`finding_type`, `review_action`, `evidence_strength`, `blast_radius`, `reproducibility`) into hypothesis state via `args.narrative` or `args.evidence_refs`. The propose/update-hypothesis tools therefore validate ARGS through the same recursive classification-key denylist `containsClassificationKey` from `src/types/tool-result.ts:83-103` BEFORE writing the registry: any args object that recursively contains a classification key returns `Result.err(ClassificationKeyInArgs)`, the tool's invoke records `tool_result_reject`, the registry stays unmutated. A new registry-level invariant test (V18-equivalent for hypotheses) asserts the registry NEVER contains a classification key at any depth across the full lifecycle.

### R3 — Sample-row enumeration scope

**Picked: (a) `read-sample-rows` tool, Mode B only + service-role + sandbox-only env-guarded + (codex SO-R3-ROW-CARVEOUT [APPLIED]) ONLY rows tagged with the current scan's `scan_id` metadata OR explicitly listed in an operator-supplied table+column allowlist.** LIMIT 3; redacted; documented carve-out in `CLAUDE.md` §MCP.
**Runner-up:** (c) PostgREST observation-only (no row enumeration).
**Tradeoff:** Option (c) is closer to the current §MCP "never query user rows" wording, but the operator's IDOR-probe gap is real — cc-11-3's `path_params.id` is currently AI-guessed and hits 404 on synthetic sandboxes. Option (a) is a *narrow* carve-out: only under `sandbox_active_validation` policy, only against a sandbox `project_ref`, only with `'read_sandbox_sample_rows'` in `allowed_actions`, only LIMIT 3, redacted via the existing `Redactor` before re-entering `view`, and `read_only_evidence` continues to deny it.

**Codex disposition [APPLIED — SO-R3-ROW-CARVEOUT]:** the carve-out is FURTHER narrowed beyond "LIMIT 3 + redaction." The tool refuses to return rows unless one of two conditions holds: **(i) the row's `metadata.scan_id` (or equivalent `tags` column) matches the current scan's `scan_id`** — i.e. the AI can only read rows Veyra itself created via `synthesize-actor` / its probes — **OR (ii) the caller's `tableAllowlist` option (set in `registerActiveValidationTools(...)` from operator-supplied `--mode-b-tables <name,name>` argv) explicitly includes the target table+column set**. Without one of those, the tool returns `Result.err(NotAllowed)`. The operator-supplied table allowlist is what makes reading "untagged" rows possible — it requires deliberate operator scope and is logged in the loop-trace + cleanup-proof as `read_sample_rows_scope: 'veyra_tagged' | 'operator_allowlisted'`. `execute_sql` stays denied; the new tool wraps `from(table).select([allowlistedColumns]).eq('scan_id', current_scan_id).limit(3)` via the SDK, not raw SQL. Operator approval for the allowlist is part of `--approve-active` semantics — the existing approval gate is the scope-acknowledgement boundary.

### R4 — Roadmap order

**Picked:** 40d (briefing) → 40e (hypothesis registry) → 39b (catalog migration) → 40f (sample-row tool, gated to Mode B) → 40g (risk prioritization + narrative integration).
**Runner-up:** 28 (Lovable MCP code) first, on the basis that Supabase-only scans are currently blind to authn/authz code.
**Tradeoff:** 40d → 40e is the dependency chain the operator's gap actually traces (briefing is the AI's first informed decision; hypothesis registry is what carries that information across iterations). 39b unblocks the AI from being able to *test* 12 of the 17 controls (without it, no amount of orchestration improvement helps because there is only one runtime probe). 40f is the targeted fix for cc-11-3 / cc-11-13a–e probe accuracy. 40g is the polish layer. Step 28 (Lovable code reading) is real but separable — it expands the *input surface*, not the *orchestration shape*; it parallels this roadmap rather than blocks it.

### R5 — Does 40c-v3 ship as-is or get folded?

**Picked: (a) ship 40c-v3 as-is.** It is the foundation this roadmap builds on.
**Runner-up:** (b) bundle 40d into 40c-v3.
**Tradeoff:** 40c-v3 is already on disk with tests green, supersedes through two codex rounds, and locks decisions A–G that 40d / 40e need to read (closure-passed registries, `ToolContext` unchanged, redaction discipline). Folding the briefing step into it would re-open the v3 review surface for a v4 — net negative. Status update on 40c-v3 proceeds independently; 40d starts from a stable 40c-v3.

---

## Roadmap

| # | id | title | depends-on | what-lands | key-verification |
|---|---|---|---|---|---|
| 1 | **40d** | Project briefing — pre-loop deterministic synthesis | 40c-v3, existing `ai-product-understanding` | A pre-loop step that reads `InventoryBootstrap` + schema metadata + lockfile artifacts and synthesizes a `ProjectBriefing` (purpose, user-roles, sensitive-table candidates, dependency surface, observed trust boundaries). Surfaced to the AI as a new read-only `view.briefing` field on `LoopView`. Briefing is also persisted as `project-briefing.json` for the audit trail. AI provider call is reused from `ai-product-understanding/agent.ts` but routed through the Bedrock provider seam (no new provider). | Vitest: snapshot of `ProjectBriefing` over the vulnerable-lovable-supabase fixture is deterministic across runs; `loop-trace.jsonl` row 0 carries `briefing_digest`; `--no-ai` plan-walker still works (briefing falls back to a structural-only briefing with no AI call). |
| 2 | **40e** | Hypothesis registry — in-loop iterative reasoning | 40d, 40c-v3, existing `src/types/hypothesis.ts` | New `HypothesisRegistry` class (closure-injected like `WriteRegistry`). Two new tool descriptors registered in `tool-registration.ts`: `propose-hypothesis` (writes to registry, requires no AllowedAction beyond a new `'propose_hypothesis'` no-op action), and `update-hypothesis` (mutates status: open / confirmed / refuted / inconclusive, with required `evidence_refs` pointing at accepted facts). `LoopView` gains `readonly hypotheses: readonly HypothesisProjection[]`. The registry is persisted post-loop as `hypotheses.json`. Floor (Step 35) reads hypothesis state ONLY to emit `coverage_gap` when an `open` hypothesis is never resolved — it does NOT promote hypotheses to Findings (preserves §D.1 / §D.2 invariants). | Vitest: AI can propose, then close, a hypothesis across iterations; hypotheses survive `loop-trace.jsonl` audit (one row per mutation, hypothesis_id only — never reasoning text raw); a hypothesis with classification keys in any payload fails the §D.2 recursive guard; fixture e2e asserts at least one hypothesis is opened and closed within the budget. |
| 3 | **39b** | Probe-primitive catalog migration — 12 remaining entries | 39 (done), 40e (so probes can be tied to hypotheses), 38 | Migrates the 12 `CatalogEntry` probes that Step 39 deferred (cc-11-1, cc-11-2, cc-11-4, cc-11-6, cc-11-9, cc-11-12, cc-11-13a–e) into runtime `ProbePrimitive`s with `requestSchema {aiAuthored, fixed}` markers, deterministic outcome classifiers on the floor, and `executeWriteWithRegistry()` discipline. No new control_ids; this is migration only. | Vitest: each of the 12 has a `requestSchema` + outcome classifier; fixture e2e exercises at least one per control_id under Mode B; cleanup roundtrip on each is green; import-graph guard (§D.2) stays green. |
| 4 | **40f** | Sample-row enumeration tool — Mode B carve-out | 40e, 40b, 40c-v3 | New `read-sample-rows` tool (`src/connectors/supabase/admin-tools/read-sample-rows/tool.ts`); `required_action: 'read_sandbox_sample_rows'` (NEW AllowedAction added only to `sandbox_active_validation` policy mode). LIMIT 3, redacted via `Redactor` before re-entering view, denied in `read_only_evidence` and `approved_production_safe`. Result-schema returns *opaque row-handles* (sha256 of primary-key + redacted column hints) — never raw row content reaches the AI. CLAUDE.md §MCP gets a narrow amendment paragraph naming this carve-out, distinguishing it from `execute_sql` which stays denied. | Vitest: tool denied under Mode A; tool produces ≤3 row-handles under Mode B; raw column values absent from `state_view_digest`; cc-11-3 probe under Mode B successfully uses a row-handle as `path_params.id` and triggers `proven_allowed` on the vulnerable fixture; redaction-roundtrip pinned. |
| 5 | **40g** | Risk-prioritized proposals + rationale audit | 40d, 40e, 39b | Extends `aiProposalSchema` (in `agentic-loop.ts:91-101`) for `invoke_tool` / `spawn_deep_dive` arms with optional `priority_score: number ∈ [0, 1]` and `rationale_excerpt: string` (output-language-lint enforced, allowed-claims vocab only). `loop-trace.jsonl` records both fields per row. Narrative author (Step 36) extends to render "why this probe was chosen" cards using rationale excerpts. AI is *prompted* to prefer high-residual-risk controls but no scoring is enforced server-side — the deterministic floor / ledger remain the truth, this is observability over AI choices. | Vitest: proposal without `priority_score` still accepted (backward-compat); proposal with classification-shaped vocab in `rationale_excerpt` rejected by claim-linter; fixture e2e shows ≥1 trace row carries both fields; output-language-lint over rationale excerpts green. |

**Cross-cutting:** Step 28 (Lovable MCP code reading) is parallel and unblocking for the Supabase-only operator scenario — it is NOT in the smart-orchestration critical path but should be sequenced concurrently. Listed under "deferred / parallel" below.

---

## MVP critical path

**Codex disposition [APPLIED — SO-MVP-MISSING-TARGET-DISCOVERY]:** the operator framing "smart orchestration" includes two distinguishable claims: (i) the AI is *risk-aware* in its choices, and (ii) the AI's probes hit *real targets*. The MVP three (40d/40e/39b) deliver (i). They do NOT deliver (ii) on synthetic sandboxes — probe `path_params.id` remains guessed and most probes will land on 404 without 40f. Two paths:

**Path A — the original MVP claim, narrowed.** 40d + 40e + 39b is the minimum for **"risk-aware orchestration"** (the operator sees the AI is thinking about which controls matter, holding hypotheses across iterations, picking probes deliberately). It does NOT promise accurate IDOR/PostgREST targeting — that needs 40f. Three steps; ship Cut 3.

**Path B — the full MVP for "AI orchestrates AND probes hit real targets."** 40d + 40e + 39b + **40f**. Four steps; ship Cut 4 (slightly longer).

Recommend: **Path B as the working MVP**, since the operator's stated goal is genuine end-to-end orchestration including realistic probes. Path A is the fallback if 40f's CLAUDE.md §MCP amendment turns out to be more controversial than R3 anticipates. The operator should pick.

---

## Out of scope / explicitly deferred

- **Reviving `ai-security-planner` and `ai-explainer`.** The loop + Step 36 narrative-author already cover their roles. Reviving them would re-introduce the topo-orchestrator shape the loop was built to replace.
- **Hypothesis → Finding promotion.** §D.2 import-graph guard forbids this. Hypotheses surface in the narrative; they do NOT become Findings. The floor is the sole Finding constructor.
- **Step 28 (Lovable MCP code reading).** Real and needed for Supabase-only scans, but it expands the *input surface* (more files visible to read-file), not the *orchestration shape*. Track as a parallel step, not part of this roadmap's critical path.
- **Adding new `control_id`s.** This roadmap operates over the 17 in `src/agents/evidence-report/controls.ts` — closed list per the brief.
- **Compliance vocabulary, dashboards, Slack, PR comments, autonomous remediation.** Bound by `PHASE_1_PLAN.md` §6 / `FINAL_PRODUCT_PLAN.md` §18 and §J — explicitly forbidden.
- **`execute_sql` carve-out.** Deliberately not taken. `read-sample-rows` (R3) is a narrow SDK-side carve-out; raw SQL stays denied even under Mode B, per `CLAUDE.md` §MCP.
- **Provider-specific reasoning (e.g. Claude-only prompt-cache assumptions).** All briefing + hypothesis tool calls route through the existing `AiProvider` seam so non-Bedrock providers stay first-class per FPP §2A.

---

## Drift spotted (between brief and actual repo)

- **`src/types/hypothesis.ts` exists and is still imported.** Brief said "verify if it still exists" — it does, including its `evidence_refs: ScanFactRef[]` shape which the §D.1-era `ScanFact` system used. The `LoopView` doesn't currently consume it. 40e re-uses the type but adapts the projection for the loop (read-only subset, no `ContextRequest`).
- **`src/agents/ai-product-understanding/`, `src/agents/ai-inference/`, `src/agents/ai-security-planner/`, `src/agents/ai-explainer/` all still exist on disk** with tests. Brief framed them as "torn out." PLAN §G says "DEPRECATE: P1 08d (ai-inference); P2 09 (ai-explainer → narrative-author); P2 07b (ai-security-planner)" — the agents are *deprecated in the topo sense*, not deleted. R1's "hybrid revive" leverages this: `ai-product-understanding/agent.ts` is reused for 40d.
- **Step 40c-v3 file says "Status: not started"** at `phases/phase-2-improvement/steps/40c-mode-b-bedrock-loop-runtime-wiring.md:3` — but the brief says "40c-v3's Mode B wiring is on disk + tests green." `git status` confirms there are uncommitted Bedrock-loop modifications. The operator should reconcile the step-file status line before 40d starts.
- **`probeAttempts` counter** exists on `ArtifactState` (line 84, 200–205) and is read by `RequiredEvidenceLedger` — confirms Step 40c-v3's MF-2 fix landed. 40e and 40f can rely on `state.recordProbeAttempt()` being honored.
- **No `read-sample-rows` tool anywhere in the repo** (Grep confirmed) — R3 is genuinely new. CLAUDE.md §MCP currently forbids it; the amendment paragraph is part of 40f.

---

## Standards & scalability check

- **Separation of concerns:** Briefing (40d) is pre-loop deterministic synthesis. Hypothesis lifecycle (40e) is in-loop AI authoring, registry-mediated. Risk prioritization (40g) is AI-side observability. Floor / ledger / cleanup stay untouched in their domains.
- **Composability:** New `view.briefing` and `view.hypotheses` are additive projections; existing `view.steps` + `view.facts` consumers unaffected. `HypothesisRegistry` injected like `WriteRegistry` — closure-passed, `ToolContext` unchanged.
- **Strict typing:** All new shapes use `Result<T, E>` for expected failures (hypothesis-status transitions, briefing-synthesis), branded ids for hypotheses (`HypothesisId`). Per FPP §2A, no closed unions in shared types — briefing's app-type stays a `string` with `confidence`, not an enum.
- **Testability:** Each step names its verification. Fixture (`examples/vulnerable-lovable-supabase`) is the integration target throughout; `scan-fixture` skill should be the runner.
- **Determinism and idempotency:** Briefing synthesis is one-shot per scan; same inventory → same briefing digest (snapshot test). Hypothesis registry is append-only with status transitions; one trace row per mutation. Rationale excerpts redact through the existing `Redactor` (stable-alias).
- **Scale-out shape:** Briefing producer is one module (`src/core/orchestrator/briefing/`) so a Phase 4 "GitHub briefing" or "Firebase briefing" lands as a sibling. Hypothesis tools register by `ToolId`; adding `confirm-hypothesis-by-probe` later is one new tool descriptor.
- **Observability and auditability:** Every briefing synthesis is one `loop-trace.jsonl` row 0; every hypothesis mutation is one row; `priority_score` + `rationale_excerpt` are §F additions. AI's reasoning is reconstructible without re-running the scan.
- **Failure isolation:** Briefing failure → falls back to a structural-only briefing, scan continues. Hypothesis-tool failure follows the existing `tool_error` boundary; the registry is *not* part of the floor's input. Sample-row tool failure is one `tool_error` row, never blocks the loop.

---

## Open items for the operator

Before `/step phase-2-improvement/steps/40d-project-briefing.md` is invoked:

1. **Confirm R3's CLAUDE.md §MCP amendment.** The "never query user rows" wording is currently absolute. Adding the carve-out paragraph is a deliberate amendment; operator should sign off on the exact wording before 40f starts (and before 40e references it).
2. **Confirm R5 (40c-v3 ships as-is).** The on-disk modifications need a status-line update on the 40c-v3 step file. Operator should reconcile that before this roadmap's first step starts.
3. **Confirm hypothesis-tool AllowedAction names.** `'propose_hypothesis'` and `'update_hypothesis'` are proposed names; if these collide with planned Phase 4 actions, the operator should name them now (they go into `ValidationPolicy.allowed_actions` for every mode, since hypothesis authoring is policy-mode-neutral).
4. **Confirm priority_score scoring contract (40g).** The brief says "priority_score + rationale_excerpt." Open question: does the operator want `priority_score` *displayed* in the report (operator-facing), or only in `loop-trace.jsonl` (audit-only)? This is a Step 36 / 37 narrative-author scope question that 40g closes.
5. **Confirm Step 28 (Lovable MCP code reading) scheduling.** It is parallel to this roadmap; operator should say whether 28 sequences before, after, or alongside 40d. If Supabase-only scans are the priority demo target, 28 needs to land in the same cut as 40d.
6. **Smart-orchestration budget profile (codex SO-BUDGET-HIDDEN-BLOCKER [APPLIED]).** The Step 31d/D3 default budget is 40 calls / 5 min / token cap. Briefing (1 call) + hypothesis tools (≥3 calls per hypothesis × multiple hypotheses) + 12 migrated probes + possible deep-dive sub-agents very likely exceeds 40 calls on a realistic real-project scan. Operator decision: (a) raise the smart-orchestration profile defaults (e.g. `calls=120,wall_ms=900000,steps=400`) at the CLI surface; (b) keep the 40-call default and document that smart-orchestration runs need explicit `--loop-budget` override; (c) define per-step budget caps (briefing ≤ 1 call, hypothesis-author ≤ 20 calls, probe execution ≤ 80 calls). Pick before 40e/39b implement.
