# Phase 3 — AGI Reframe (FINAL PLAN)

**Status:** final after 3 codex review rounds + 4 planner rounds (round 4 closes round-3 codex findings; no further codex review per project rule)
**Date:** 2026-05-26
**Replaces:** all prior round-N plan documents in `/tmp/`
**Pre-implementation gate:** §F ratification by user; then planner produces step-file contents; then Claude writes step files to `phases/phase-2-improvement/steps/`

## §A. Scope

Phase 3 reframes Veyra so AI authors per-app narrative, derives the control set from the app shape, interprets schema semantics. Determinism remains the evidence floor. Out of scope: autonomous remediation, hosted dashboard, compliance claims, MCP allowlist expansion, Supabase `read_only=true` relaxation. Operator surface reduction (Obs 9) and custom executable test types (Obs 3) deferred to Phase 4.

## §B. Observation coverage

| Observation | Disposition | Phase |
|---|---|---|
| Obs 1 (closed catalog) | FUNDAMENTAL → derived-controls agent + registry-extension loader | Phase 3 |
| Obs 2 (AI segregated) | FUNDAMENTAL → narrative-author agent (deterministic prose rendering) | Phase 3 |
| Obs 4 (operator inputs over-specified) | FUNDAMENTAL/TRUST → step 36 planning artifact only; default UNCHANGED in Phase 3 | Phase 3 + Phase 4 prerequisite |
| Obs 6 (per-control report) | FUNDAMENTAL → reporter rebuild adds narrative section above per-control | Phase 3 |
| Obs 8 (deterministic classification) | FUNDAMENTAL (preserved) → AI never classifies; linter is read-only output gate | Phase 3 |
| Obs 5 (regex parser) | SURFACE → kept as bounded evidence source; schema-semantics agent adds semantic layer alongside | Phase 3 |
| Obs 7 (templated coverage gaps) | SURFACE → routed through narrative pipeline (claim-linted) | Phase 3 |
| Obs 9 (19 CLI flags) | SURFACE → operator surface reduction deferred | Phase 4 |
| Obs 3 (catalog-bound test types) | SURFACE (cleanup-discipline) → withdrawn from Phase 3; cleanup-aware HTTP write registry is Phase 4 prerequisite | Phase 4 |
| Obs 10 (bolt-on pattern) | PROCESS → closed by this review loop | n/a |

## §C. New agents

1. **`app-shape-deriver`** — reads `declared-context.json` + `scan-facts.json` + repo file inventory → emits `app-shape.json` (entities, capabilities, trust boundaries, app archetype tag).
2. **`derived-controls`** — reads `app-shape.json` → emits `derived-controls.json` (union of canonical 12 + app-shape-driven additions, each with provenance).
3. **`schema-semantics`** — reads `scan-facts.json` schema slice + `app-shape.json` → emits `schema-semantics.json` (table-level interpretation: tenancy column inference, ownership-edge inference, sensitive-column candidates).
4. **`narrative-author`** — reads all upstream + `control-cards.json` → emits `narrative.json` as `ClaimRecord[]` (NO free-form prose).
5. **`narrative-renderer`** — pure function (deterministic, no AI) → turns `ClaimRecord[]` + upstream artifacts into prose using templates from `src/agents/narrative-author/templates/`.
6. **`claim-linter`** — reads `narrative.json` + upstream → emits `narrative-lint-report.json` + blocks scan completion on lint failure.

## §D. Architectural decisions

### §D.A — Claim entailment (option (a) deterministic prose rendering)

**`narrative-author` emits structured records ONLY:**

```
ClaimRecord {
  claim_id
  claim_type: 'causal' | 'recommendation' | 'descriptive' | 'cross_finding_synthesis'
  subject_id: ArtifactRef            // resolves to control / finding / entity
  predicate_output_id: ArtifactRef   // upstream element supporting the claim
  supporting_artifact_refs: ArtifactRef[]    // additional support
  template_params: Map<string, ScalarOrId>   // structured-only — see lint check (viii)
}
```

**Deterministic `narrative-renderer`** runs as a pure function over `ClaimRecord[]` + upstream. One template per `(claim_type, predicate_kind)` pair, files under `src/agents/narrative-author/templates/`, all reviewed by `output-language-lint`.

**Claim-linter checks (round-4 expanded per codex MUST-fix #3):**

1. `claim_type` is a known enum value.
2. `predicate_output_id` resolves to a real upstream artifact element.
3. The `(claim_type, predicate_kind)` pair has a registered template.
4. `template_params` satisfies the template's required-params schema.
5. For `cross_finding_synthesis`: every cited finding shares the cited root-cause tag in `schema-semantics.json`.
6. **(round-4 new)** `subject_id` resolves to a real artifact-store element.
7. **(round-4 new)** `supporting_artifact_refs` is non-empty AND every ref resolves.
8. **(round-4 new)** `template_params` values are structured — `ArtifactRef`, enum string from a per-template-declared enum, number, or boolean. **Free-form prose strings forbidden.** If a template needs a quoted user-facing string, it is sourced from a deterministic upstream artifact (e.g. `finding.title`) by reference, never from a `ClaimRecord.template_params` string field.

Failure modes:
- **Hard** (any of checks 1, 3, 6, 7, 8 fails, OR check 2 fails with malformed ref): entire AI output rejected. Single `AIConcern` of category `narrative_lint_failure` emitted with lint reason. Deterministic fallback renders.
- **Soft** (check 4 partial fail OR check 5 non-load-bearing citation): individual `ClaimRecord` dropped, others emitted with audit count.

Runner-up: (b) predicate-specific support rules over free-form AI prose. Rejected because entailment becomes heuristic, not provable.

### §D.B — Artifact registration (round-4 corrected per codex MUST-fix #1 + #2)

**Codex correction:** `AgentMetadata.produces` is **artifact basenames** (e.g. `'app-shape.json'`), NOT `ArtifactKind` enum values. Orchestrator resolves dependencies by basename match (`src/core/orchestrator/scan-orchestrator.ts:107`). There is no `consumes` field on `AgentMetadata` today. The plan honors this:

**Step 30 lands first. It performs:**

1. Extend `src/types/artifact.ts` `ArtifactKind` union with **six** new entries (round-4 adds `redaction_alias_map` per codex finding #2):
   `app_shape`, `derived_controls`, `schema_semantics`, `narrative`, `narrative_lint_report`, `redaction_alias_map`.
2. Extend `src/core/artifacts/artifact-store.ts` `basenameFor` switch with six matching basenames: `app-shape.json`, `derived-controls.json`, `schema-semantics.json`, `narrative.json`, `narrative-lint-report.json`, `redaction-alias-map.json`.
3. Each new agent's `AgentMetadata.produces` declares its **basename** (e.g. `produces: ['app-shape.json']`) — matching the existing contract, not switching to ArtifactKind enum.
4. New test `src/core/artifacts/artifact-dependency.test.ts`:
   - Each new basename in `basenameFor` is produced by exactly one registered agent (one-producer-per-basename rule).
   - `basenameFor` is total over `ArtifactKind` (TS `never` exhaustiveness + runtime test).
   - For each new basename, walk the codebase and assert it appears only in: the producer agent's `produces`, the consumer agents' input builders, and the basename mapping itself.
5. **Audit existing direct-write surfaces (round-4 added per codex finding #2):**
   - `src/cli/scan-command.ts:984,1014` reconstructs `readiness-report.json`, `declared-context.json`, `inventory-bootstrap.json` filenames directly. Step 30 does **not** migrate these; it audits that the new six basenames are NOT reconstructed outside `basenameFor`.
   - `src/agents/tool-runner/tool-runner.ts:669` deliberately bypasses `ArtifactStore` for its own write. Step 30 confirms tool-runner's bypass does not collide with new basenames.

Step 30 is pure typing + registration + audit; no agent logic. Steps 31–35 follow.

### §D.C — Stable-alias redaction

`src/ai/ai-output-redaction.ts` exports `redactAiOutput(text, aliasState)`. Aliases follow `REDACTED_<KIND>_<N>` with first-appearance ordinal; persist per scan; stored in audit-only `redaction-alias-map.json` (registered as artifact kind in §D.B). Kinds: `URL`, `ID` (UUIDs only — separate from opaque tokens per codex preference), `TOKEN` (high-entropy non-UUID), `EMAIL`. URL key is `scheme+host+path` — **planner note (round-4 per codex):** if query/fragment carries distinguishing data, URL keys must include them too; default policy is `scheme+host+path` and any template that uses URL-with-query as a load-bearing distinction must opt into wider key matching.

Existing `src/ai/sanitization.ts:33` pre-prompt single-`REDACTED` token unchanged. Output-side aliases apply only to AI OUTPUT.

Tests: alias-stability, kind-separation, readability, citation-traceability (per round-2 §D.C).

### §D.D — `ai-explainer` deprecation triggers (3-trigger contract)

1. Every fixture scan's `narrative.json` non-empty under new path.
2. `--no-ai` parity test confirms deterministic fallback emits `claim_type: 'descriptive'`-only `narrative.json` with non-empty prose per control card.
3. Repo-wide `rg`-backed test confirms no source file imports `AiEnrichment` from `src/agents/ai-explainer/agent.ts` outside the ai-explainer folder itself.

**Removal step:** Phase 4 step 01. **Round-4 correction per codex finding #4:** durability requires an actual Phase 4 step stub in `phases/phase-4/steps/01-ai-explainer-removal.md` (created by this Phase 3 plan as a placeholder, status `not started`, depending on the three triggers) — not just a header comment in the source file.

Phase 3 ships: (i) `ai-explainer/agent.ts` header comment naming three triggers + Phase 4 step pointer; (ii) Phase 4 step 01 stub file (1 page, status `not started`).

Reporter precedence: `phase2-sections.prefers-narrative.test.ts` asserts `narrative.json` wins when both `ai-enrichments.json` and `narrative.json` exist.

### §D.E — Mode B.1 drift guard (round-4 corrected per codex SHOULD-consider #4)

**Codex correction:** `phases/phase-2-improvement/decisions.md` does **not exist**. Decision 10 lives in `phases/phase-2/decisions.md:172`. CLI defaults vacuity: `buildScanCommand` doesn't currently expose Mode B flags; `parseRawOptions` omits `approveActive`, `supabaseSandbox`, `approvalFile`. The drift guard is updated to handle both:

1. **`test-actor-manifest.doc.test.ts`** reads `src/types/test-actor-manifest.ts` and asserts the literal substring `"default per step 2.01 decision 10"` in the file header.
2. **`scan-command.default-mode.test.ts`** is **conditional**: it first asserts whether Mode B flags exist in `parseRawOptions` (`approveActive`, `supabaseSandbox`, `approvalFile`). If they do NOT exist (current state), the test asserts that fact and passes. If they DO exist (post-step-29 wiring), the test asserts no commander option default flips Mode B sub-mode to auto-synthesize / path (a) / B.2. Removes vacuity by requiring presence-then-content.
3. **Decisions-file regression-reference** lands in `phases/phase-2/decisions.md` (round-4 corrected path) under a new "Drift Guards" section, naming Phase 4 prerequisites from round-2 §D.H.4.

### §D.G — Agentic tool-invocation orchestration (NEW user direction 2026-05-26 — separate architectural pivot)

**User said: *"Every tool invocation goes through a policy gate AI calls dynamically — AI will decide which tools needs to be run."***

This is the agentic-loop architecture we surfaced earlier and the user has now confirmed they want it. It is a separate pivot from §D.A–§D.F. PLAN.md's current shape (deterministic topo-sort orchestrator, AI as analyst over collected evidence) does not deliver this. Agentic loop is:

```
while not done:
  next = ai.propose_next_action(artifacts_so_far)
  if next.kind == 'invoke_tool':
    gate = policy.allows(next.tool, next.params)
    if gate.allowed:
      result = invoke(next.tool, next.params)
      save(result)
    else:
      record_denial_as_AIConcern(gate.reason)
  elif next.kind == 'done':
    break
generate_report(artifacts_so_far)
```

**What is materially new about this:**
- AI decides which tool runs (Phase 1/2/3 today: orchestrator does).
- AI decides params for each tool call (where applicable).
- Policy gate becomes the inner loop, not a per-agent boundary.
- The scan's flow is dynamic; topo-sort is replaced.

**Honest framing — what this means for Phase 3 as currently planned:**

This is **NOT addressable inside the existing Phase 3 codex-reviewed plan.** Reasons:

1. The 3-codex-round cap on THIS plan is exhausted. The agentic-loop pivot has not been reviewed by codex at any round.
2. Codex's round-1/2/3 verdicts were against a plan where orchestration stays deterministic. Adding agentic orchestration changes the foundation those verdicts rested on; the existing "RESOLVED" markings on round-1/2/3 findings would need to be re-evaluated.
3. Trust-model amendments H.1–H.5 were each scoped against a deterministic orchestrator. Agentic orchestration introduces a new trust-model concern (AI deciding when to stop, AI being able to deny information to itself, AI's policy-gate-denial signal being itself an input to the next AI decision) that none of H.1–H.5 cover.

**This step proposes splitting it explicitly:**

- **Phase 3 (current PLAN.md, §D.A–§D.F, steps 30–42)** ships as planned: Mode A narrative reframe + Mode B AI-authored request parameters within catalog-bound schemas. Deterministic orchestrator stays.
- **Phase 4 — "Agentic Veyra"** is a new planning cycle. Its own PROBLEMS.md, its own planner output, its own 3-round codex review budget, its own user ratifications. Phase 4 supersedes Phase 3's orchestrator (`src/core/orchestrator/scan-orchestrator.ts`) with an agentic loop and rebuilds the trust-model around dynamic tool selection.

**Why this split, not a single phase:**

- Phase 3 as written is shippable and has been through 3 codex rounds. Bundling agentic orchestration in would mean either (a) throwing away the 3 codex rounds and restarting, or (b) shipping the agentic pivot un-reviewed by codex. Both are wrong.
- The agentic pivot needs its own diagnostic of every Phase 1/2/3 step that assumes a deterministic orchestrator. That's the same shape of work PROBLEMS.md did for Mode A reporting — it deserves the same rigor.
- Splitting lets Phase 3 deliver concrete value (reframed report + AI-authored request params) while Phase 4 takes its own time to land the bigger architectural pivot safely.

**Ratification 5 added to §F (below):** Confirm the split. Phase 3 ships §D.A–§D.F. Agentic orchestration becomes its own Phase 4. Alternative: stop Phase 3, throw away the 4 planner rounds + 3 codex rounds, restart as one combined "Agentic Veyra Phase 3" plan from scratch.

### §D.F — AI-authored request method/URL/body (NEW — user ratification 2026-05-26)

Round-1 codex REJECTED this work (then-H.3) because (a) cleanup tracks Supabase identities from `synthetic-resources.json`, not app rows created via HTTP (`synthetic-data-manager/agent.ts:159-178`); (b) the planner can pass arbitrary `parameters.method/url/body/headers` and the runner executes them (`active-validation-policy-compiler.ts:132-170`, `sandbox-runner/agent.ts:155-184`); (c) free-form writes are cleanup-blind.

User decided 2026-05-26 to include this capability in Phase 3 with the prerequisite safety guardrails codex named. Phase 3 now ships the capability AND its safety floor in the same cut.

**What lands (5 new components):**

1. **Cleanup-aware HTTP write registry** — new module `src/core/sandbox/http-write-registry.ts`. Every state-changing HTTP call (POST/PUT/PATCH/DELETE) made during Mode B writes a `{ method, url, response_id_paths, created_resources: ResourceRef[] }` entry. The cleanup phase reads the registry and reverses each entry by issuing the inverse call (DELETE for POST, restore-snapshot for PATCH, etc.) as the appropriate actor. Registry persists as `http-write-log.json` artifact (registered as 7th new artifact kind in §D.B).

2. **Per-catalog-entry request schemas** — every catalog entry that allows writes declares a `requestSchema: { method, urlTemplate, bodySchema }` typed contract. AI may parameterize fields the schema marks `aiAuthored: true`; cannot author fields the schema marks `fixed`. The compiler validates AI's proposed request against the entry's schema before execution.

3. **Composition-linter (new component, NOT same as claim-linter)** — `src/core/sandbox/composition-linter.ts`. Validates: (i) any write call references a registry-backed cleanup target; (ii) the actor's `allowed_actions` set includes the write capability; (iii) every URL path segment AI authored matches the schema's regex bound; (iv) request body validates against Zod schema declared by the catalog entry. Hard-fail rejects the entire scan; soft-fail rejects the single test.

4. **AI request authoring** — `narrative-author`-sibling agent `ai-request-author` reads `app-shape.json` + actor manifest + catalog entries with `requestSchema` → emits `proposed-requests.json` of `ProposedRequest[]` records:
   ```
   ProposedRequest {
     catalog_entry_id
     actor_id
     ai_authored_params: Map<string, ScalarOrId>
     justification_claim: ClaimRecord     // re-uses §D.A linter
   }
   ```
   AI does NOT emit raw HTTP. AI emits which catalog entry + which actor + parameter values + a justification claim that goes through the citation linter from §D.A.

5. **Trust-model amendment H.5 (NEW)** — Phase 2 step 01 preventer decision 9 amended: catalog-bound test universe expands to allow AI-authored parameter values within typed bounds. The test TYPE remains catalog-fixed. The PARAMETERS (which row id, which column name, which body field value) are AI-authored within `requestSchema`. The amendment requires explicit user ratification (added to §F as ratification 4).

**Safety floor mandatory for Phase 3:**
- Composition-linter blocks every Mode B scan whose `proposed-requests.json` contains an entry violating any of the four checks. No bypass flag.
- HTTP write registry is mandatory: every write call goes through `executeWriteWithRegistry()`. Direct write calls are a code-review-blocking lint failure.
- Cleanup phase fails the scan if any registry entry reverses unsuccessfully — the scan reports a `cleanup_failed` launch-blocker finding citing the un-reversed write.
- A real-sandbox-project gate (Phase 2 step 01 preventer decision 8) runs against a representative project; every gate cycle exercises at least one write-then-cleanup roundtrip with assertion that the target table row count returns to pre-scan state.

**Trust-model risks added (round-4 addendum to §I):**
- AI authors a write whose `requestSchema` allows it but whose effect surprises the operator. Mitigated by: requestSchema's `aiAuthored: true` fields are bounded; URL path regex enforces shape; body Zod validates field-by-field.
- Cleanup registry has a hole — AI writes via a path the registry doesn't capture. Mitigated by: `executeWriteWithRegistry()` is the SOLE entry point for write calls; any direct `fetch()` write in catalog code is a lint failure.
- AI authors a malicious body payload (SQL injection in a `text` field, prototype pollution). Mitigated by: body Zod schema rejects anything outside the declared shape; per-field input length caps; PostgREST handles SQL parameter binding deterministically.
- Operator misunderstands the new authority. Mitigated by: README trust-mode matrix (§K) explicitly states "Mode B with AI-authored request params is the new Phase 3 default; opt out via `--no-ai-request-authoring`."

## §E. Steps

**Step numbering 30–42 (Phase 3 only — expanded from 30–38 to accommodate §D.F).**

| # | Title | Depends on |
|---|---|---|
| 30 | Register 7 new artifact basenames + dependency test + direct-write audit | none |
| 31 | `app-shape-deriver` agent | 30 |
| 32 | `derived-controls` agent | 30, 31 |
| 33 | `schema-semantics` agent | 30, 31 |
| 34 | `narrative-author` + `narrative-renderer` + `ai-output-redaction.ts` | 30–33 |
| 35 | `claim-linter` agent | 30, 34 |
| 36 | Plan-only: Mode B sub-mode default ratification + drift guard | 30 |
| 37 | Reporter integration: prefer `narrative.json`; mark `ai-explainer` deprecated + 3-trigger contract + Phase 4 step 01 stub | 34, 35 |
| 38 | `--no-ai` fallback: deterministic `descriptive`-only narrative | 34, 35 |
| **39** | **HTTP write registry + `executeWriteWithRegistry()` + cleanup-reverse-walk + lint guard rejecting direct writes** | **30** |
| **40** | **Per-catalog-entry `requestSchema` declaration + retrofit existing 13 catalog entries with their schemas** | **39** |
| **41** | **`composition-linter` agent + 4 checks (cleanup-binding, allowed_actions, URL regex, body Zod)** | **40** |
| **42** | **`ai-request-author` agent emits `ProposedRequest[]` + `proposed-requests.json` artifact + cleanup roundtrip assertion in fixture gate** | **40, 41, 35** |

Phase 4 step 01 (forward reference, lands as stub in this phase): executes `ai-explainer` removal once all 3 triggers hold.

## §F. Decisions for user ratification (BEFORE step files land)

1. **Claim entailment approach.** Planner picked option (a) deterministic prose rendering. Tradeoff: lower expressive ceiling, provable entailment. Confirm or override.
2. **Mode B sub-mode default.** Phase 3 ships drift guards + Phase 4 prerequisites; no code change to default. Confirm.
3. **Phase 4 step 01 placement for `ai-explainer` removal.** Planner picked Phase 4 step 01 (first cleanup of Phase 4). Phase 3 ships the stub file. Confirm or override.
4. **(NEW 2026-05-26) AI-authored request parameters in Mode B (§D.F).** Phase 3 expands AI's authority: AI authors HTTP method (where the catalog entry allows), URL path parameters, and body field values — all bounded by per-catalog-entry `requestSchema` + cleanup-aware HTTP write registry + composition-linter (4 deterministic checks). Trust-model amendment H.5 (preventer decision 9 amended): catalog-bound TEST TYPE; AI-authored PARAMETERS. Confirm or override. Override-path: defer §D.F to Phase 4; ship Phase 3 with §D.A–§D.E only.

## §G. Planner-picked decisions

1. App-shape + control-derivation as separate agents.
2. Narrative agent is one (not three per-section).
3. AI-output redaction in `src/core/policy/` shape, sibling to existing `src/ai/sanitization.ts`.
4. Citation linter deterministic, zero AI calls.
5. `ai-explainer` deprecates but does not delete in Phase 3 — removal in Phase 4 step 01 stub.
6. Two new fixture variants (state-machine + ownership-edge) — step 41 (deferred — see §H below).
7. `narrative.json` carries structured-id `cites` arrays, not freeform inline citations.
8. FPP doc shape: additive sub-section under §12.
9. AI budget unchanged from Phase 2.
10. `--ai-provider` flag remains explicit.

## §H. Out of scope / deferred

- **Step 41 (fixture extension + regression gate).** Round-3 plan listed step 41; round-4 final plan defers to Phase 3 cut 2 once steps 30–38 land and operator-side §F ratifications complete. Reduces single-cut size.
- **Pairwise catalog composition** — H.3 withdrawn; Phase 4 prerequisite.
- **Mode B default change** — H.4 withdrawn; Phase 4 prerequisite (cleanup-aware HTTP write registry + isolation guarantees).
- **Operator surface reduction (Obs 9)** — Phase 4.
- **Custom executable test types (Obs 3)** — excluded by preventer 9; not reopened.

## §I. Trust-model risks + guardrails

14 risks (round-2) preserved. Round-3/4 additions: AI smuggling prose through `template_params` (mitigated by §D.A check viii); artifact-kind drift (mitigated by §D.B audit); `--no-ai` deterministic-fallback path required for `ai-explainer` removal trigger #2.

## §J. Sequencing

**Phase 3 Cut 1 (steps 30–38) — Mode A reporting reframe:** Land registration + new agents + narrative authoring + lint + reporter integration + `--no-ai` fallback + drift guards.

**Phase 3 Cut 2 (steps 39–42) — Mode B AI-authored requests (§D.F):** HTTP write registry + per-entry requestSchemas + composition-linter + ai-request-author. Cut 2 ships only after Cut 1's deterministic narrative path is proven, so a broken Cut 2 doesn't take down the report.

**Phase 3 Cut 3 (deferred — fixture variants):** Fixture extension with two app-shape variants (state-machine + ownership-edge) + end-to-end regression gate including write-then-cleanup roundtrip from §D.F.

**No Phase 3 step file lands until §F (4 ratifications) is complete.**

Cut 1 ships when: all steps 30–38 pass codex review individually + end-to-end smoke against existing fixture produces non-empty `narrative.json` + lint passes + `--no-ai` parity holds.

## §K. README update plan (mandatory deliverable, lands alongside steps)

Per PROBLEMS.md §"Deliverables that follow plan approval":

Top-level README updated AFTER user ratifies §F + step files land + before any code merges. 4-mode trust matrix (Mode A, B.1, B.2, C-reserved) with credential ask, isolation guarantees, default-or-opt-in, `--no-ai` interaction. Runs through `output-language-lint`. Reviewed with codex as the mandatory deliverable (separate from this plan's review budget — README review counts as its own document's review, not as a continuation of the plan review).

## §L. Disposition of all codex findings across 3 rounds

| Source | Item | Status |
|---|---|---|
| Round 1 | 10 findings + 4 verdicts | All RESOLVED or WITHDRAWN (H.3 + H.4) |
| Round 2 | 12 prior RESOLVED + 2 PARTIAL + 4 new + 1 question | All APPLIED (PARTIALs + new closed by round 3) |
| Round 3 | 4 new findings (3 MUST + 1 SHOULD) | All APPLIED in this round-4 plan |

**Round-3 finding closure (in this final plan):**
- MUST #1 (basename vs ArtifactKind contract) → §D.B updated; `produces` uses basenames not enum values; `consumes` not referenced.
- MUST #2 (artifact accounting + direct-write surfaces) → §D.B adds `redaction_alias_map` as 6th kind; direct-write audit added; `scan-command.ts:984,1014` + `tool-runner.ts:669` confirmed not in collision.
- MUST #3 (linter checks insufficient) → §D.A adds checks 6, 7, 8 (subject_id resolution, supporting_artifact_refs non-empty + resolving, template_params structured-only).
- SHOULD #4 (drift guard path + vacuity) → §D.E fixes path to `phases/phase-2/decisions.md`; CLI test made conditional on flag presence to avoid vacuous pass.

## §M. Pre-implementation gate

Before step files land in `phases/phase-2-improvement/steps/`:
1. User reads this plan (`phases/phase-2-improvement/PLAN.md`).
2. User ratifies §F (3 decisions).
3. Planner round 5 produces step-file contents for steps 30–38.
4. Claude writes step files to disk.
5. Each step file is reviewed with codex individually (each step's review counts separately from the plan's 3-round budget).
