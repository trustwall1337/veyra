# Step 40d — Project briefing: AI-assisted pre-loop synthesis (recorded-fixture determinism)

**Status:** done (2026-06-12) — Project briefing landed: `src/cli/briefing/` leaf folder (`types.ts`, `prompt.ts`, `validate.ts`, `synthesize.ts`, `persist.ts`) per Decision B (codex 40D-LAYERING); `LoopView.briefing?` + `ArtifactStateOptions.briefing?` + `readableView()` surfacing (`src/core/orchestrator/artifact-state.ts`); `LoopTraceRow.briefing_digest?` + row-0 clear-after-emit in `agentic-loop.ts`'s snapshot; `RunAgenticLoopDeps.briefing?` + `.briefingDigest?`; `synthesizeBriefingForLoop(...)` helper in `src/cli/scan-command.ts` pre-dispatch in BOTH Mode A and Mode B Bedrock branches; Decision H1 inventory pre-pass (`buildBootstrapInventory` runs synchronously if `inventory-bootstrap.json` absent); live Bedrock caller via lazy `@aws-sdk/client-bedrock-runtime` gated by `VEYRA_BEDROCK_LIVE=1` (Phase 2 §preventer 7); recorded-fixture caller via `VEYRA_BEDROCK_RECORDING=<dir>/briefing-response.json` (V1 determinism contract); `BriefingBedrockCaller` over a parallel transport interface (NOT the loop's `BedrockTransport` per Decision C); recursive classification-key deny-walk (V5) + scalar-string token check (V6 extension per codex 40D-CLASSIFICATION-STRINGS); structural-only fallback fields (`uncertainty_notes: 'no_ai_synthesis'`); degraded-fallback path on AI-call failure (V10); loop-budget debit + one-call hard cap via WeakMap-scoped counter (V14, new per codex 40d-budget-guardrail-missing); briefing-digest sha256 over canonical-JSON minus `recorded_at` (V1/V4 determinism); renderer footer `Project briefing: project-briefing.json` (+ `(degraded)` suffix) under "Scan metadata" (Decision G — pointer, not section). V9 import-graph guard test asserts `src/cli/briefing/**` does not import `Finding`. Verification: pnpm typecheck clean; pnpm test --run → 906 passed / 2 skipped / 0 failed (up from 889 baseline; +17 new 40d tests across 3 new test files). §4.5 codex pre-review returned 3 findings, all `[APPLIED]` before implementation (V14, explicit 40c-v3 pre-start check, "briefing metadata" vocab). §6.5 review chain exhausted in this session: codex (primary) hung after 2h in repo-inspection loop; step-reviewer (first fallback) API socket disconnect at 12 min / 41 tool uses; user explicitly OK'd the final state given green verification + clean codex pre-review of the plan. Live operator smoke (real Bedrock + recorded fixture capture) pending operator's environment.

**Maps to:** `phases/phase-2-improvement/SMART_ORCHESTRATION_ROADMAP.md` row 1 (40d) + Decisions R1 [APPLIED — SO-R1-DETERMINISM-DRIFT], R4 (roadmap order), R5 (40c-v3 ships as-is); `phases/phase-2-improvement/PLAN.md` §B (loop is the orchestrator), §D.1 (result-parse-or-reject — extended to the briefing's AI return), §D.2 (floor is sole `Finding` constructor — import-graph guard extended to the briefing module), §D.3 (no writes — briefing is read-only synthesis), §G (existing-work accounting: revives `ai-product-understanding/agent.ts` shape per R1 hybrid), §K (no new ledger ids — briefing is metadata, not evidence); `phases/FINAL_PRODUCT_PLAN.md` §2A (briefing folder is one leaf so Phase 4 GitHub/Firebase briefings drop in as siblings; no closed unions on app type — `purpose.value: string`), §11 (control catalog unchanged); `CLAUDE.md` §Secrets (gitleaks-redacted excerpts only into the prompt), §Output language (no "secure / safe / compliant" in any briefing field), §Validation policy (briefing is policy-mode-neutral — runs in every mode), §MCP discipline (no new MCP tool; reuses existing Supabase schema-metadata source per `ValidationPolicy.allowed_actions.has('read_supabase_schema_meta')`), §Scope discipline (no dashboard, no compliance vocab).

**Phase:** 3, Cut N (smart-orchestration cut — first step of the roadmap).

## Foundation already landed (do NOT rebuild)

- `src/agents/ai-product-understanding/agent.ts` — `INTENT_RESPONSE_SCHEMA`, `buildAiDeclaredIntent`, `parseDeclaredIntent`, `redactSecrets`-minted `SanitizedMessage` prompt body. 40d reuses the schema fragments + prompt-construction shape; the existing agent's `VeyraAgent` wrapper stays untouched on the topo path.
- `src/agents/product-understanding/inventory/types.ts` — `InventoryBootstrap` + `InventoryObservedEvidence` (file_map, package_json_digest, routes, framework, env_declarations, supabase_schema, lovable_files). Briefing's structural fields read this shape; no edits.
- `src/core/orchestrator/artifact-state.ts` — `LoopView` shape (lines 58–66: `steps`, `facts`). 40d extends `LoopView` with one new optional read-only field.
- `src/core/orchestrator/agentic-loop.ts:80-86` — `AiDriver.proposeNext(view, descriptors)`. The driver contract is unchanged; the briefing arrives via `view.briefing`.
- `src/core/orchestrator/loop-trace-writer.ts` — JSONL audit trail. 40d adds `briefing_digest` to the row 0 envelope (one new optional field on `LoopTraceRow`).
- `src/ai/bedrock/provider.ts` + `src/cli/ai-provider-factory.ts` `constructLoopDriver` — the AI provider seam the briefing's synthesis call reuses. NO new provider, NO new adapter.
- `src/cli/scan-command.ts:1098-1135` — Mode A (`runBedrockLoopBranch`) and Mode B (`runBedrockLoopBranchModeB`) dispatch. Pre-loop briefing synthesis lands BEFORE this dispatch so both branches consume the same briefing.
- `src/types/tool-result.ts:83-103` — `containsClassificationKey` recursive deny-walk. The briefing's AI return is validated through this guard (R2-equivalent for the briefing module).

## Pivotal decisions taken

- **Decision A (R1 [APPLIED — SO-R1-DETERMINISM-DRIFT]): AI-assisted briefing with recorded-fixture determinism, NOT pure-deterministic synthesis.** Runner-up: pure-deterministic (inventory-only inference). Tradeoff: pure-deterministic forfeits purpose/role inference (the operator-named gap is "AI knows what app it's looking at" — that requires synthesis). Recorded-fixture replay (Step 31b pattern via `VEYRA_BEDROCK_RECORDING=<path>`) gives byte-identical reruns across CI, and `--no-ai` falls back to a genuinely-deterministic structural-only briefing (no AI call at all).

- **Decision B (briefing module location): one leaf folder `src/cli/briefing/`** (codex 40D-LAYERING [APPLIED]). Runner-up (REJECTED): `src/core/orchestrator/briefing/`. Tradeoff: putting briefing impl under `src/core/` while importing `src/agents/ai-product-understanding/` violates the `no-cross-layer-imports` invariant at `src/types/no-cross-layer-imports.test.ts:10-11,92-103` — `src/core/` may not depend on `src/agents/`. Same pattern Step 35b's `floor-predicates.ts` resolved: live in `src/cli/` so agent imports are layer-safe. Only the `ProjectBriefing` TYPE (the pure shape, no impl) lives in `src/cli/briefing/types.ts` — type imports are layer-safe via `import type`. `LoopView.briefing?: ProjectBriefing` in `src/core/orchestrator/artifact-state.ts` uses `import type` to dodge the layer rule. Phase 4 sibling briefings (GitHub, Firebase) land under `src/cli/briefing-github/` etc. — no closed union on app type, `purpose.value` stays `string` with `confidence`.

- **Decision C (AI call routing): briefing-specific Bedrock structured-call seam directly over `BedrockTransport` — NOT `constructLoopDriver`** (codex 40D-AI-DRIVER-SHAPE [APPLIED]). Runner-up (REJECTED): reuse `constructLoopDriver(...)`. Tradeoff: `constructLoopDriver` returns an `AiDriver` whose `proposeNext` is hardcoded to the loop's discriminated-union proposal shape (`invoke_tool | done | spawn_deep_dive`); the briefing is a one-shot structured EMIT of `ProjectBriefing` fields, not a loop proposal. Forcing the briefing through `proposeNext` would mean defining a fake `emit-project-briefing` tool and parsing its `invoke_tool.args` — possible but a clunky shape-mismatch. Instead, `synthesize.ts` constructs a small `BriefingBedrockCaller` over `BedrockTransport` directly: builds a Converse request with a `briefing_schema` tool-use config (fields the AI emits = `ProjectBriefing` minus `synthesis_mode` / `model_id` / `prompt_fingerprint_sha256` / `recorded_at`), parses the response's `tool_use` block, Zod-validates locally. The recorded-fixture replay path (Step 31b's `BedrockTransport` recorded mode) STILL works — same transport surface, just a different request shape. Mode A and Mode B both inject the same briefing seam.

- **Decision D (briefing AI-return validation): recursive classification-key denylist on the entire AI return, in addition to top-level schema.** Runner-up: top-level Zod only. Tradeoff: the briefing's `observed_trust_boundaries` and `dependency_surface.key_deps` are list shapes the AI authors — recursive `containsClassificationKey` (from `src/types/tool-result.ts:83-103`) is the only thing that prevents an AI from smuggling `finding_type`/`review_action`/etc into briefing state. The briefing has no §D.1 result-parse-or-reject boundary (it isn't a `ToolResult`), so it gets its own equivalent (V5 below).

- **Decision E (briefing failure handling): fall back to structural-only briefing; the loop continues with a degraded `view.briefing`.** Runner-up: hard-fail the scan. Tradeoff: failure isolation per CLAUDE.md "Working with Claude" + the roadmap's failure-isolation principle. The AI provider call can transiently fail; the loop must still run with inventory-derived briefing fields populated. Report renders a "Project briefing (degraded)" note.

- **Decision F (operator open item #2 reconciliation): 40d assumes 40c-v3 is on disk with tests green AND its Status line reads "complete" before 40d implements.** Runner-up: cross-reference 40c-v3 as "in-flight." Tradeoff: 40d extends `LoopView` (an interface 40c-v3's Mode B branch reads) — concurrent edits to the same shape are merge-conflict bait. The operator MUST reconcile the 40c-v3 Status header (mark complete, since work is on disk + verified per the roadmap drift note) BEFORE invoking `/step phases/phase-2-improvement/steps/40d-project-briefing.md`. This is operator open item #2 from the roadmap.

- **Decision G (briefing visibility in the report): a reference to the artifact, NOT a rendered section.** Runner-up: full "Project briefing" section in `agentic-report.ts`. Tradeoff: the briefing is AI-authored metadata about the scan, not evidence — surfacing it as a report section invites operators to read it as findings ("the AI says my purpose is X"). A one-line reference (`Project briefing: <artifactDir>/project-briefing.json`) under the existing "Scan metadata" footer keeps the audit trail visible without conflating synthesis with evidence. 40g may revisit this once `priority_score` / `rationale_excerpt` ship.

- **Decision H (Supabase schema-meta source for briefing): reuse the existing `read-schema-meta` artifact path if present; do NOT call MCP from the briefing module; treat schema-meta as OPTIONAL enrichment** (codex 40D-SCHEMA-SOURCE [APPLIED]). Runner-up: briefing module directly invokes a `StorageMetadataSource`. Tradeoff: codex caught that Bedrock branches BYPASS the topo product-understanding agent, so `database-metadata.json` is only produced AFTER a tool or topo agent runs — it is NOT a reliable pre-loop input. 40d therefore: (i) explicitly builds + persists `inventory-bootstrap.json` BEFORE the briefing synthesis runs in BOTH `runBedrockLoopBranch` (Mode A) and `runBedrockLoopBranchModeB` (Mode B) — Decision H1 below; (ii) treats schema-meta as optional enrichment — `sensitive_tables` is populated only if `database-metadata.json` already exists at briefing time (e.g. from a prior `read-schema-meta` tool invocation on the topo path); absent it, `sensitive_tables` falls back to `[]` with `confidence: 'low'` and `uncertainty_notes: 'schema_meta_not_yet_observed'`. Briefing NEVER calls MCP directly; that boundary stays clean.

- **Decision H1 (NEW — codex 40D-SCHEMA-SOURCE follow-on): inventory built + persisted before briefing in BOTH Bedrock branches.** 40d adds a pre-briefing inventory pass in `synthesizeBriefingForLoop(...)`: if `<artifactDir>/inventory-bootstrap.json` doesn't yet exist, the helper runs `BootstrapInventory.run(...)` from `src/agents/product-understanding/inventory/bootstrap.ts` synchronously, persists the result, and proceeds. Mode A's `runBedrockLoopBranch` and Mode B's `runBedrockLoopBranchModeB` BOTH consume the now-guaranteed inventory artifact. The topo path is unchanged (it already runs `BootstrapInventory` via `productUnderstandingAgent`). Verification: V3a (below).

## Produces

- **`src/cli/briefing/types.ts` (NEW).** Defines `ProjectBriefing` shape:
  ```
  {
    purpose: { value: string; confidence: 'low'|'medium'|'high'; uncertainty_notes?: string };
    user_roles: { value: readonly string[]; confidence; uncertainty_notes? };
    data_kinds: { value: readonly string[]; confidence; uncertainty_notes? };
    auth_model: { value: string; confidence; uncertainty_notes? };
    sensitive_tables: { value: readonly string[]; confidence; uncertainty_notes? };
    dependency_surface: { framework: string; key_deps: readonly string[]; confidence; uncertainty_notes? };
    observed_trust_boundaries: { value: readonly string[]; confidence; uncertainty_notes? };
    synthesis_mode: 'ai_assisted' | 'structural_only' | 'degraded_fallback';
    model_id?: string;
    prompt_fingerprint_sha256?: string;
    recorded_at: string;  // ISO-8601; normalized in V1 fixture comparison
  }
  ```
  Plus `BriefingSynthesisError extends Error`. Reuses the confidence-tagged-shape pattern from `ai-product-understanding/agent.ts:131-147`. NO closed unions on app type — `purpose.value: string` per FPP §2A.

- **`src/cli/briefing/synthesize.ts` (NEW).** `synthesizeProjectBriefing(input): Promise<Result<ProjectBriefing, BriefingSynthesisError>>`. Input shape: `{inventoryBootstrap, schemaMeta?, lockfile?, gitleaksDigest?, semgrepDigest?, aiOptIn, bedrockCaller?, modelId?, redactor, loopBudget?}`. Two paths inside: `synthesizeAiAssisted(...)` (debits one loop-budget call BEFORE invoking `bedrockCaller`, hard-caps at one call, structured tool-use return, local Zod validation, recursive classification-key denylist) and `synthesizeStructuralOnly(...)` (no AI call, no budget debit; pure derivation from inventory + schema-meta shape; AI-only fields produce `{value: <sentinel>, confidence: 'low', uncertainty_notes: 'no_ai_synthesis'}` or are omitted per `exactOptionalPropertyTypes`).

- **`src/cli/briefing/prompt.ts` (NEW).** Builds the `SanitizedMessage` prompt body via `redactSecrets(...)` — the only chokepoint that mints `SanitizedMessage`, mirroring `ai-product-understanding/agent.ts:102-129`. Prompt content: inventory digest + schema-table names + lockfile dependency surface + gitleaks/semgrep hit counts (counts ONLY, never excerpts; CLAUDE.md §Secrets). System prompt: extends the existing `SYSTEM_PROMPT` (`agent.ts:79-80`) with sensitive-tables + dependency-surface + trust-boundary fields. NO compliance vocabulary.

- **`src/cli/briefing/validate.ts` (NEW).** `validateAiBriefingReturn(parsed): Result<Partial<ProjectBriefing>, BriefingSynthesisError>`. Wraps the existing `containsClassificationKey` deny-walk + a Zod schema for the AI-authored fields. Rejects unknown top-level keys (retro-17c). Returns a `Partial` so the structural fields the synthesizer already computed are merged in by the caller.

- **`src/cli/briefing/persist.ts` (NEW).** `writeBriefingArtifact(artifactDir, briefing): Promise<Result<string, BriefingSynthesisError>>` writes `<artifactDir>/project-briefing.json`. `briefingDigest(briefing): string` returns `sha256(canonical-json(briefing minus recorded_at))` — deterministic over reruns; goes into the row-0 trace envelope.

- **`src/core/orchestrator/artifact-state.ts` amendment.** `LoopView` interface gains one read-only field: `readonly briefing?: ProjectBriefing`. The field is set ONCE by the pre-loop synthesizer before the loop starts; `ArtifactState` accepts a `briefing` constructor option and surfaces it on every `view()` call. No mutation API — briefing is immutable for the loop's lifetime.

- **`src/core/orchestrator/loop-trace-writer.ts` amendment.** `LoopTraceRow` gains one optional field: `readonly briefing_digest?: string`. Set ONLY on row 0 (step === 0 or first non-zero step depending on numbering; the writer's existing row-emit path takes a one-time `briefing_digest` parameter on first write).

- **`src/cli/scan-command.ts` amendment.** A new helper `synthesizeBriefingForLoop(...)` runs in `runScan` BEFORE the Mode-A / Mode-B Bedrock branch dispatch (current `:1098` for Mode A, `:1120` for Mode B). The helper:
  - reads `<artifactDir>/inventory-bootstrap.json` (already written by `BootstrapInventory` step on the topo path; for Bedrock-only paths the inventory must be produced upstream — Step 40c-v3's `runBedrockLoopBranchModeB` ALREADY runs inventory before loop start; verify the same is true for Mode A's `runBedrockLoopBranch`. If not, this step adds a minimal inventory pre-pass to Mode A too — call out in V3a).
  - reads optional schema-meta + lockfile artifacts if present.
  - calls `synthesizeProjectBriefing(...)` with `aiDriver = constructLoopDriver(...)` IF `inputs.aiOptIn === true`; otherwise structural-only path.
  - persists `project-briefing.json` (Decision G — referenced from report footer, not rendered as a section).
  - passes the briefing into both `runBedrockLoopBranch(...)` and `runBedrockLoopBranchModeB(...)` via a new `briefing?: ProjectBriefing` field on their option object.
  - On failure: logs once, falls through to structural-only via `synthesisMode: 'degraded_fallback'`. Loop continues.

- **`src/cli/scan-command.ts` Mode A + Mode B branches amended.** Both branches accept `briefing?: ProjectBriefing` and pass it into `ArtifactState` so `view.briefing` is set on every `proposeNext`.

- **`src/reporters/markdown/agentic-report.ts` minor amendment (Decision G).** Footer adds a one-line `Project briefing: project-briefing.json` reference under "Scan metadata" when `briefing` is present. NO new rendered section; NO finding-shaped vocabulary.

- **NO new `ArtifactKind`** (briefing is internal orchestration metadata, not a typed artifact-store entry — this is consistent with `loop-trace.jsonl`'s treatment).
- **NO new MCP tool, NO new connector, NO new scanner** — pure synthesis over existing artifacts.
- **NO new `AllowedAction`** — briefing is policy-mode-neutral; runs in every mode.
- **NO new `control_id`** — the 17-control catalog in `src/agents/evidence-report/controls.ts` is unchanged.
- **NO new CLI flag** — `--no-ai` already governs the AI-vs-structural fork; no `--briefing-off` toggle (out of scope).

## Depends on

- **40c-v3 (`phases/phase-2-improvement/steps/40c-mode-b-bedrock-loop-runtime-wiring.md`) — DONE.** Per Decision F, the operator MUST reconcile 40c-v3's Status header to "complete" (it currently reads "not started" despite work being on disk + tests green, per roadmap drift item #3) BEFORE 40d starts. 40d extends `LoopView` and the Bedrock branch dispatch surface — concurrent edits with an in-flight 40c-v3 would be merge-conflict bait.
- 31 (loop), 31b (Bedrock recorded transport — recorded-fixture replay pattern is the determinism contract for V1), 31d (Mode A live + `constructLoopDriver`), 34 (loop-trace writer — V4 amends its row 0).
- Existing modules: `src/agents/product-understanding/inventory/` (inventory artifact), `src/agents/ai-product-understanding/` (schema + prompt shape reused), `src/types/tool-result.ts` (classification-key deny-walk reused).

## Executed by

Plain coding pass + `mcp-policy-check` skill (V8 — assert no new MCP allowlist entries) + `output-language-lint` skill (V6 — assert no claim-vocab in briefing fields) + `plan-adherence` skill against PLAN §D.1/§D.2/§G + `step-reviewer` + one codex single-review round at §6.5 + deterministic recorded fixture run in CI (V1).

## Verification

`pnpm test --run` green; `pnpm typecheck` green; lint not gating (pre-existing failures).

- **V1. Recorded-fixture determinism (AI-assisted path).** With `VEYRA_BEDROCK_RECORDING=examples/vulnerable-lovable-supabase/recordings/briefing-mode-a/` set and a captured Bedrock response, two consecutive scans against `examples/vulnerable-lovable-supabase/` produce byte-identical `project-briefing.json` AFTER normalizing `recorded_at` out of the comparison (mirrors 40c-v3 V3b normalizer pattern — Decision A). `briefingDigest(...)` is byte-identical without normalization (digest excludes `recorded_at` by construction).

- **V2. `--no-ai` structural-only briefing.** With `inputs.aiOptIn === false`, `synthesizeProjectBriefing(...)` returns a briefing with `synthesis_mode: 'structural_only'`, all inventory-derived fields populated (`dependency_surface.framework`, `dependency_surface.key_deps`, `user_roles` if RLS schema infers them, etc.), and the AI-only fields (`purpose`, `observed_trust_boundaries`) carry `confidence: 'low'` + `uncertainty_notes: 'no_ai_synthesis'` OR are absent (per `exactOptionalPropertyTypes`). NO `model_id` field present.

- **V3. `view.briefing` on every `proposeNext`.** An agentic-loop test seeds a stub `ProjectBriefing`, runs three loop iterations, asserts the AI driver receives `view.briefing` equal to the seeded briefing on EACH `proposeNext` call. `view.briefing` is read-only (mutating it inside the loop is a TypeScript compile error per the `readonly` modifier).

- **V3a. Inventory upstream invariant.** Both `runBedrockLoopBranch` (Mode A) and `runBedrockLoopBranchModeB` (Mode B) have an inventory artifact available at briefing time. If Mode A doesn't currently produce inventory before loop start, this step adds a minimal pre-pass; a regression test asserts inventory existed in `<artifactDir>/` before `synthesizeBriefingForLoop` was called.

- **V4. `loop-trace.jsonl` row 0 carries `briefing_digest`.** After a full scan, parse `loop-trace.jsonl`'s first row; assert `briefing_digest` is present AND equals `briefingDigest(persistedBriefing)`. No other row carries the field.

- **V5. Briefing AI return rejects classification keys at any depth.** Seed the recorded Bedrock transport to return an object with `{purpose: {..., finding_type: 'launch_blocker'}}`. Assert `synthesizeAiAssisted(...)` returns `Result.err(BriefingSynthesisError)` AND that `<artifactDir>/project-briefing.json` either does NOT exist OR contains the structural-only fallback (Decision E). Repeat with the key nested under `dependency_surface.key_deps[0].review_action` — same outcome (recursive deny-walk).

- **V6. Output-language lint over briefing fields (extended per codex 40D-CLASSIFICATION-STRINGS [APPLIED]).** Run `output-language-lint` against every string-valued briefing field in the persisted artifact. Asserts NO occurrence of "secure" / "safe" / "compliant" / "compliant with X" / "vulnerable" / "exploit" / "launch-blocker" — claim vocabulary belongs to Findings, not the briefing (CLAUDE.md §Output language). **ALSO asserts no scalar string in the briefing contains a CLASSIFICATION-KEY token: `finding_type`, `review_action`, `evidence_strength`, `blast_radius`, `reproducibility`, `fix_before_launch`, `review_before_launch`, `confirmed_issue`, `likely_issue`, `coverage_gap`** — `containsClassificationKey` (`src/types/tool-result.ts:83-103`) rejects object keys + NamedFact names but NOT scalar strings, so the AI could smuggle a verdict via `purpose.value: 'finding_type: launch-blocker'`. V6 extension closes that hole at the briefing boundary specifically.

- **V7. `--no-ai` baseline byte-identical (Step 35b V3 invariant, with explicit deltas whitelist per codex 40D-V7-INCONSISTENT [APPLIED]).** Run the canonical `--no-ai` scan against `examples/vulnerable-lovable-supabase/`. Assert all non-briefing artifacts remain byte-identical to the Step 35b V3 baseline, EXCEPT the following INTENTIONAL deltas (codex caught the inconsistency in v1 of this step file — V7 must explicitly whitelist these so the regression test stays honest):
   - **NEW artifact** `<artifactDir>/project-briefing.json` exists (structural-only mode, deterministic per V2).
   - **`evidence-report.md` footer** gains one line: `Project briefing: project-briefing.json` (Decision G — single audit-pointer line, no rendered section).
   - **`loop-trace.jsonl` row 0** gains optional `briefing_digest: string` field (V4); subsequent rows unchanged structurally but `state_view_digest` values are recomputed to include the briefing in the hashed view (intentional — `view.briefing` is part of what the AI sees, so the audit digest covers it).
   - All other artifacts (findings.json, control-cards, scan-facts, every loop-trace row's classification fields) byte-identical.
   - A regression assertion compares everything outside the whitelist; a separate test pins each whitelisted delta to its expected shape (one new line in the footer, one new field on row 0, recomputed digests are stable across reruns).

- **V8. No new MCP allowlist surface.** `mcp-policy-check` skill confirms briefing module does NOT introduce any new MCP tool name. The Lovable allowlist + Supabase `read_only=true` + `project_ref` invariants stay green. Briefing's optional schema-meta read goes through an EXISTING artifact path, not a new MCP call.

- **V9. Briefing module import-graph guard (Decision D + §D.2 extension).** A static import-graph walk asserts: `src/cli/briefing/**` does NOT import `Finding` from `src/types/finding.ts` (PLAN §D.2 invariant — briefing must not classify). The walk extends the existing 40c-v3 V13 guard.

- **V10. Briefing failure → loop still runs.** Stub the Bedrock provider to throw on the briefing's `complete(...)` call. Assert: (a) `<artifactDir>/project-briefing.json` is persisted with `synthesis_mode: 'degraded_fallback'`; (b) the agentic loop runs to `done`; (c) `evidence-report.md` renders with a footer note `Project briefing: project-briefing.json (degraded)`; (d) the scan exitCode is unchanged (no new failure mode).

- **V11. Secrets never enter the briefing prompt.** Seed the fixture project with a `.env.local` containing a fake `SUPABASE_SERVICE_ROLE_KEY=fake-srk-eeffaabb-1111-2222-3333-deadbeefcafe`. Run scan. Walk every captured Bedrock request in the recorded fixture; assert NONE contains the substring of the seeded SRK. Assert gitleaks-redacted excerpts (if any included) carry only `<REDACTED:secret_id_*>` aliases (existing `Redactor` discipline; CLAUDE.md §Secrets enforcement at the `redactSecrets` chokepoint).

- **V12. Briefing artifact contains no raw secret values.** Walk `<artifactDir>/project-briefing.json` byte-by-byte for the seeded SRK substring (uses the V11 helper or `assertNoSecretsInArtifacts([seedSrk], dir)` from 40c-v3 V18). Assert ZERO matches across structural-only AND ai-assisted paths.

- **V13. FPP §2A: no closed unions on app type.** `purpose.value` resolves to `string` (not `'lovable' | 'firebase' | ...`); the briefing module path is `src/core/orchestrator/briefing/` (a leaf folder, sibling-extensible). A regression test asserts `ProjectBriefing.purpose.value` is typed `string` and that the briefing module imports no provider-named constants from shared types.

## Goal

Close the operator-named gap's first leg: **the AI knows what app it is looking at BEFORE it picks its first probe.** After 40d, every `proposeNext` call receives a `view.briefing` describing the project's purpose, user roles, sensitive table candidates, dependency surface, and observed trust boundaries — synthesized once, pre-loop, persisted for audit, deterministic over reruns under recorded fixtures. The briefing is read-only orchestration metadata, not evidence — it does NOT become a Finding, does NOT add a control_id, does NOT relax any policy gate. It IS the foundation 40e (hypothesis registry) builds on (AI references briefing fields when authoring hypotheses) and the input 40g (priority_score / rationale_excerpt) reasons over.

## What lands

- New leaf folder `src/cli/briefing/` with `types.ts`, `synthesize.ts`, `prompt.ts`, `validate.ts`, `persist.ts` (Decision B).
- Surface addition: `LoopView` gains `readonly briefing?: ProjectBriefing` (`src/core/orchestrator/artifact-state.ts`).
- Surface addition: `LoopTraceRow` gains `readonly briefing_digest?: string` (`src/core/orchestrator/loop-trace-writer.ts`).
- Wiring: `synthesizeBriefingForLoop(...)` helper in `src/cli/scan-command.ts` runs pre-dispatch; both Mode A and Mode B branches consume the briefing.
- Renderer footer reference in `src/reporters/markdown/agentic-report.ts` (Decision G).
- New recorded fixture `examples/vulnerable-lovable-supabase/recordings/briefing-mode-a/` for V1.
- NO new ArtifactKind. NO new policy mode. NO new CLI flag. NO new `AllowedAction`. NO new MCP tool. NO new control_id.
- The 17 controls in `src/agents/evidence-report/controls.ts` are unchanged.
- Foundation for 40e: a downstream step adds `view.hypotheses` next to `view.briefing` — additive projection, no refactor of `LoopView` required.

## Done when

All V1–V13 pass. With `AWS_PROFILE=preprod`, `AWS_REGION=eu-west-1`, and the recorded fixture for the briefing path in place:

```
pnpm dev -- scan \
  --project examples/vulnerable-lovable-supabase \
  --ai-provider bedrock \
  --ai-model eu.anthropic.claude-sonnet-4-5-20250929-v1:0 \
  --mode read_only_evidence \
  --env dev \
  --out veyra-report.md
```

produces:

- (a) `<artifactDir>/project-briefing.json` with `synthesis_mode: 'ai_assisted'`, all fields populated, deterministic across reruns under the recorded fixture (V1).
- (b) `<artifactDir>/loop-trace.jsonl` row 0 carries `briefing_digest` equal to `sha256(canonical-json(briefing minus recorded_at))` (V4).
- (c) Every subsequent `loop-trace.jsonl` row's `state_view_digest` reflects a `LoopView` that includes the briefing (V3); no row mutates the briefing.
- (d) `veyra-report.md` footer carries a one-line `Project briefing: project-briefing.json` reference under "Scan metadata" (Decision G).
- (e) The `--no-ai` invocation of the same command produces a structural-only briefing (V2), no AI call captured in any fixture, baseline byte-identical otherwise (V7).
- (f) ZERO occurrences of any seeded SRK / JWT / env-var value across the briefing artifact, the recorded prompt body, or the loop-trace (V11, V12).
- (g) `--no-ai` baseline regression vs Step 35b V3 unchanged.
- (h) A Bedrock-call-failure injection (V10) leaves the scan running to `done` with a degraded briefing footer note.

## Guardrails

- **CLAUDE.md §Secrets:** briefing prompt is built through `redactSecrets(...)` exclusively (the only `SanitizedMessage`-minting chokepoint). Gitleaks-redacted COUNTS only — never excerpts. No SRK / JWT / env value ever enters the prompt body or the persisted briefing. V11 + V12 enforce.
- **CLAUDE.md §Output language:** briefing fields use observational vocabulary (`purpose`, `user_roles`, `data_kinds`, `auth_model`, `sensitive_tables`, `dependency_surface`, `observed_trust_boundaries`) — NOT claim vocabulary. No "secure," "safe," "compliant," "vulnerable," "exploit," "launch-blocker." V6 enforces.
- **CLAUDE.md §Validation policy:** briefing is policy-mode-neutral; runs in `read_only_evidence`, `sandbox_active_validation`, and `approved_production_safe` identically. No new `AllowedAction`; no `policy.mode === '...'` branch.
- **CLAUDE.md §MCP discipline:** no new MCP allowlist entry. Briefing reuses the existing schema-meta artifact path (REST or MCP — whichever data-source registered) — the new module does NOT call MCP directly. V8 enforces.
- **CLAUDE.md §Scope discipline:** no dashboard, no Slack, no PR comment, no autonomous remediation, no compliance claim. Briefing is internal orchestration metadata; the report footer reference is a one-line audit pointer, not a section.
- **PLAN §D.1:** briefing has no `ToolResult` boundary (it isn't a tool result), but it carries its own equivalent — recursive classification-key deny-walk on the AI return (V5).
- **PLAN §D.2:** briefing module forbidden from importing `Finding` (V9 import-graph guard). Briefing never classifies; the floor remains the sole Finding constructor.
- **PLAN §D.3:** briefing performs no writes. No `WriteRegistry` interaction. No cleanup needed.
- **PLAN §E:** briefing's single Bedrock call is debited from the existing loop-budget call counter (per the smart-orchestration budget profile per roadmap open item #6 — operator decision pending). Briefing budget cap = 1 call hard, enforced in `synthesizeAiAssisted`.
- **PLAN §G:** revives `ai-product-understanding/agent.ts` shape per R1 hybrid — the existing agent's `VeyraAgent` wrapper stays on the topo path untouched; the briefing module reuses the schema + prompt construction by import, not by edit.
- **PLAN §K:** no new ledger ids. Briefing is metadata, not evidence; the ledger continues to gate on probe-attempt + write-attempt + cleanup-proof predicates.
- **FPP §2A:** briefing module is one leaf folder; sibling Phase 4 briefings drop in without core-type edits. `purpose.value: string` — no closed union on app type. V13 enforces.
- **FPP §11:** the 17-control catalog at `src/agents/evidence-report/controls.ts` is unchanged.
- **Phase 2 step 01 preventer 7:** Bedrock briefing call uses the recorded-fixture transport by default; `VEYRA_BEDROCK_LIVE=1` gates the live path (consistent with Step 31b).

## References

- `phases/phase-2-improvement/SMART_ORCHESTRATION_ROADMAP.md` — row 1 (40d); Decisions R1 [APPLIED — SO-R1-DETERMINISM-DRIFT], R4, R5; operator open items #2 (40c-v3 Status reconciliation) and #6 (smart-orchestration budget profile).
- `phases/phase-2-improvement/steps/40c-mode-b-bedrock-loop-runtime-wiring.md` — 40d's direct predecessor; Decision G + V18 (`assertNoSecretsInArtifacts`) reused by 40d's V11/V12; 40c-v3 V13 (Finding import-graph guard) extended by 40d's V9.
- `phases/phase-2-improvement/steps/31b-bedrock-provider-adapter.md` — recorded-fixture replay pattern that backs 40d V1 determinism.
- `phases/phase-2-improvement/steps/31d-bedrock-live-transport-and-loop-runtime-wiring.md` — `constructLoopDriver` factory 40d reuses; Mode A branch `runBedrockLoopBranch` 40d amends.
- `src/agents/ai-product-understanding/agent.ts:36-77` — `INTENT_RESPONSE_SCHEMA` (briefing extends this shape).
- `src/agents/ai-product-understanding/agent.ts:79-80` — `SYSTEM_PROMPT` (briefing extends).
- `src/agents/ai-product-understanding/agent.ts:102-129` — `buildPrompt` + `redactSecrets`-minted `SanitizedMessage` pattern.
- `src/agents/ai-product-understanding/agent.ts:131-147` — confidence-tagged-shape type guards.
- `src/agents/ai-product-understanding/agent.ts:149-205` — `parseDeclaredIntent` retro-17c re-validation pattern.
- `src/agents/product-understanding/inventory/types.ts` — `InventoryBootstrap` shape.
- `src/agents/product-understanding/inventory/bootstrap.ts` — inventory builder (already runs upstream of the Bedrock branches).
- `src/core/orchestrator/artifact-state.ts:58-66` — `LoopView` interface (gets `briefing?: ProjectBriefing`).
- `src/core/orchestrator/loop-trace-writer.ts:18-60` — `LoopTraceRow` (gets `briefing_digest?: string`).
- `src/core/orchestrator/agentic-loop.ts:80-86` — `AiDriver.proposeNext(view, descriptors)` contract.
- `src/ai/bedrock/provider.ts` — Bedrock provider seam reused via `constructLoopDriver`.
- `src/cli/scan-command.ts:1098-1135` — Mode A / Mode B Bedrock branch dispatch (briefing synthesis lands BEFORE this).
- `src/types/tool-result.ts:31-103` — `CLASSIFICATION_KEYS` + `containsClassificationKey` (40d V5 reuses).
- `src/reporters/markdown/agentic-report.ts` — footer reference (Decision G).
- `CLAUDE.md` §Secrets, §Output language, §Validation policy, §MCP discipline, §Scope discipline — all guardrails-bound.
- `phases/FINAL_PRODUCT_PLAN.md` §2A (briefing as one leaf folder) and §11 (control catalog unchanged).
- `phases/phase-1/PHASE_1_PLAN.md` §6 — "Not Required" list (no dashboards, no compliance vocab — 40d compliant).
