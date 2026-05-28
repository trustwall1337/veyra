# Phase 3 (Agentic Veyra) — ratified decisions

Canonical record of the §I decisions the user ratified on 2026-05-27, after 3 codex review rounds on `PLAN.md`. Future planner/step runs consult this file.

## D1 — Cleanup-aware write authority: YES, registry-gated, no bypass

AI may author HTTP writes (method/URL/body, Directive 1), but ONLY behind the mandatory unified `WriteRegistry` covering both write paths (HTTP transport + Admin SDK), with a deterministic reverse-walk cleanup and a `cleanup_failed` launch-blocker. No bypass flag. Matches planner recommendation.

**Implication:** §D.3 + Step 38 are mandatory before any AI-authored write ships (Cut 3). `executeWriteWithRegistry()` is the sole HTTP write entry; direct mutating `fetch()`/`transport.send()` is a lint-blocking failure.

## D2 — Mode B default: FLIP to auto-synthesize (B.2) — OVERRIDES planner recommendation + AMENDS preventer decision 10

The user chose B.2 (auto-synthesize) as the documented Mode B default, overriding the planner's recommendation to keep B.1 (manifest). This **amends Phase 2 step 01 preventer decision 10** ("manifest mode is the default documented Mode B path").

**What this means:**
- Default Mode B requires a **service-role key** (env var only, never argv, never chat). Veyra creates synthetic users itself; no operator manifest required by default.
- This is a deliberately larger credential surface than B.1, accepted by the product owner in exchange for the zero-manual-setup ("agentic and smart") UX the owner has required throughout.
- B.1 (manifest) remains available as an opt-in for operators unwilling to provide a service-role key.
- The auto-synthesize path's cleanup (D1's unified WriteRegistry, Path 2 Admin SDK) is mandatory and its failure is a launch-blocker — the larger credential surface is bounded by mandatory cleanup + the `--env production` reject + the actor-count safety cap from the prior planning rounds.

**Trust note (must surface in README + CLAUDE.md amendment):** Phase 3 ships with B.2 default. The README trust-mode matrix and CLAUDE.md must state plainly that the documented Mode B happy-path requires a service-role key and that Veyra creates + cleans up synthetic users. This is a binding amendment to preventer decision 10; the prior "B.1 default, B.2 power-user opt-in" wording is superseded for Phase 3.

## D3 — Loop budget defaults: 40 calls / 5 min / token cap

`max_tool_calls = 40`, `max_wall_clock_ms = 5 min`, `max_ai_cost_units = ` a token-based cap (exact token number set at step-authoring time). All three independent, first-trips-wins; denials/rejects/tool-errors/result-rejects count; `max_steps` backstop. CLI-overridable via `--loop-budget`. Matches planner recommendation.

## D4 — Loop driver provider: Anthropic via AWS Bedrock

The agentic loop driver uses **Anthropic models accessed through AWS Bedrock**, not the direct Anthropic API.

**What this means (NEW scope vs the plan as reviewed):**
- The plan assumed the already-wired direct-Anthropic adapter (Phase 2 step 04) as the loop driver. Bedrock is a **different adapter**: AWS IAM / SigV4 auth (env: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` or an AWS profile), the Bedrock `InvokeModel` / Converse API surface, Bedrock model IDs for Claude.
- This requires a **new `bedrock` provider adapter** behind the existing provider-agnostic `AiProvider` / `AiDriver` interface (FPP §2A — one folder per provider, opaque `ProviderId`, no closed union). It is NOT a modification of the direct-Anthropic adapter.
- A new Phase 3 step is added for the Bedrock adapter (see PLAN.md §H addendum). The loop-driver interface stays provider-agnostic; Bedrock is the default concrete provider; direct-Anthropic + OpenAI remain available adapters.
- Prompt caching, structured output (tool_use / Converse tool config), and the prompt-fingerprint/model_id audit fields all route through the Bedrock adapter the same as any provider.

**Trust note:** the Bedrock credential is an env-var-only AWS credential; per CLAUDE.md §Secrets it never appears on argv or in any artifact/log/trace. The loop-trace `model_id` records the Bedrock model id for audit + rollforward.

## D5 — `--no-ai` write-probe promise: planner default ACCEPTED unless objected

Not asked in the ratification batch (4-question cap). The plan's §E option (b) stands as the default: under `--no-ai`, read-only tools get full coverage; write probes needing an AI-authored target emit a floor `coverage_gap` ("active write-probe requires AI planning; re-run without `--no-ai`"). Recorded here as accepted-by-default; the user may override.

---

## D6 — Bounded multi-agent: orchestrator + deep-dive sub-agents (2026-05-27)

The single agentic loop (orchestrator) may spawn **bounded deep-dive sub-agents** to thoroughly investigate ONE target (e.g. one table's policy graph, one suspected IDOR). NOT parallel fan-out, NOT specialization-by-domain — deep-dive only, the most auditable + deterministic shape.

**Locked design constraints (the planner must honor):**
- **Depth cap = 1.** The orchestrator spawns sub-agents; a sub-agent CANNOT spawn further sub-agents. Prevents unbounded recursion.
- **Narrow tool subset.** A sub-agent receives a scoped subset of the tool catalog relevant to its deep-dive target, not the full catalog. Reduces blast radius.
- **Budget is debited from the parent, no escape.** A sub-agent's tool-call/wall-clock/cost budget counts against the parent's total `--loop-budget`. A sub-agent cannot extend the overall scan budget.
- **Same trust spine.** Sub-agent tool calls go through the SAME policy gate + result-parse-or-reject boundary; sub-agents emit facts only and NEVER classify (the deterministic floor stays the sole Finding producer).
- **Sequential / limited concurrency.** Deep-dive sub-agents run sequentially (or a small bounded concurrency) so the loop trace stays reconstructable + deterministic under a stubbed driver.
- **Nested audit.** Sub-agent steps are logged in `loop-trace.jsonl` with a `parent_step` reference so an operator can see which deep-dive produced which facts.
- **Failure isolation.** A sub-agent that errors → its deep-dive target becomes a `coverage_gap` (via the §K ledger); the parent orchestrator continues.

**Codex budget for this addition:** 2 rounds (it is an addition to an already-3-round-reviewed plan, not a from-scratch architecture).

## Orphaned item from superseded Phase 1 step 29

Phase 1 step 29 (Mode B CLI wiring + closeouts) was SUPERSEDED 2026-05-27 by this Phase 3 plan (Step 40/40b replace its CLI wiring; Step 30/33 subsume its data-source closeouts). One item it carried is NOT addressed by the agentic plan and remains open:

- **Approval-file signature verification.** Step 29 had `skipSignatureVerify: true` as a stub and deferred real minisign/cosign verification to a "step 30." The agentic Mode B inherits the approval flow but the plan does not implement signature verification. This is an open item for a future phase (Phase 4 or a dedicated approval-hardening step). Recorded here so it is not lost when step 29 leaves the active set.

## Net effect on PLAN.md

- §I.1 (D1) → confirmed; no plan change.
- §I.2 (D2) → **plan amended**: Mode B default flips to B.2; preventer decision 10 amended; README + CLAUDE.md must state the service-role-key default. The §M trust-mode matrix's "default?" column updates (B.2 default, B.1 opt-in).
- §I.3 (D3) → confirmed; numbers recorded.
- §I.4 (D4) → **new scope**: a Bedrock provider-adapter step added to §H; loop-driver interface stays provider-agnostic.
- §I.5 (D5) → planner default accepted.
