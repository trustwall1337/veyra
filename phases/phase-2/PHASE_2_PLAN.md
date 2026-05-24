# Phase 2 — Sandbox Active Validation + AI-Assisted Reasoning

> **Internal-only context.** The `phases/` directory is gitignored on purpose.
> This document is planning material, not a product-facing deliverable.

Author: planner pass 2026-05-24, building on `phase-1/PHASE_1_PLAN.md` and the validation-policy seam landed in `phase-1/steps/02-foundation-types-artifact-store-policy.md`.

---

## §0 Status and Scope

Phase 2 turns Veyra from a read-only evidence reporter into a tool that can **prove** controls in sandbox environments and **explain** findings with AI assistance. It is the first phase in which Veyra is permitted to mutate state — and only Veyra-created state, only in non-production environments, only with explicit user opt-in, and always with verifiable cleanup.

**Extensibility constraint carries forward.** Per `FINAL_PRODUCT_PLAN §2A`, every Phase 2 capability lands behind the same opaque ID / registry pattern as Phase 1. The `SandboxExecutor` is registered by `ConnectorId`, not switched on `'supabase'`. The synthetic-data-manager works against any database / identity provider that registers a synthetic-data adapter — Phase 2 ships the Supabase adapter only, but a future Firebase or Clerk adapter must drop in without changing the manager's contract. The negative-test catalog is keyed by `control_id`, not by provider. The AI explainer is per-`EvidenceKind`, not per-connector.

Phase 2 also resolves the AI question that Phase 1 left open. The "AI Security Reasoning" capability described in `PHASE_1_PLAN.md §3 Step 4 — AI Security Reasoning (deferred to Phase 2)` lands here, not in Phase 1, because (a) Phase 1's deterministic backbone must work without AI, (b) wiring AI inside Phase 1 risks coupling classification to a model, and (c) AI explanations are most useful once active validation produces concrete outcomes to explain.

What Phase 2 is **not**:

- Not production active validation. That is a later phase (see `FPP §17 Phase 5` for the product-rollout placement of "safe live-product validation").
- Not an offensive security tool. No brute force, no credential testing, no exploitation, no privilege escalation.
- Not an autonomous remediator. AI never decides what to fix or merges anything.
- Not a compliance tool. Phase 2 outputs are still evidence-shaped per `phase-1/PHASE_1_PLAN.md §9` allowed-claims vocabulary.

The bar that says "Phase 2 is done" is in §8.

---

## §1 Verified Capabilities (for Phase 2)

This section enumerates exactly what Phase 2 is permitted to use, what it must not use even when available, and the citations for each. The discipline mirrors Phase 1 §1.

### 1.1 Supabase Management & Auth Admin API

- **Permitted**:
  - `auth.admin.createUser({ email, password, user_metadata: { veyra_scan_id, veyra_synthetic: true } })` — creates a synthetic identity tagged with the scan id.
  - `auth.admin.deleteUser(uid)` — cleanup path.
  - INSERT / DELETE on user-application tables, **but only on rows tagged with `veyra_scan_id` metadata** (preferred: a dedicated `veyra_synthetic_data` column, or a separate Veyra-only schema).
  - Storage object upload + delete, **only into Veyra-created paths under a sandbox-scoped prefix**.
- **Forbidden**:
  - Any mutation of pre-existing rows. Veyra-created rows only.
  - Any operation against a project that is not declared as a sandbox.
  - Storing the service-role key in artifacts, logs, or AI prompts.
  - Calling Supabase MCP tools that Phase 1 forbids (`execute_sql`, `apply_migration`, etc.). The Admin API path is separate from the MCP path and has stricter rules.

### 1.2 Lovable Preview Environments

- **Permitted**: read declared context from the same six-tool MCP allowlist Phase 1 uses (`get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` with fixed templates).
- **Forbidden**: any Lovable mutation tool, deployment trigger, or remix. Phase 2 does not change the Lovable allowlist.

### 1.3 Anthropic Claude API

- **Permitted**: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` for explanation generation, suggested-test refinement, and control-card narrative. Prompt caching required on the system prompt and the canonical control catalog.
- **Forbidden**: tool-use loops that mutate Veyra-managed state. Computer-use and agentic-loop modes are out of scope.

### 1.4 OpenAI API (fallback)

- **Permitted**: a single chat-completion adapter as a fallback when Anthropic is unavailable. Same sanitization rules.
- **Forbidden**: any "automatic browsing" or "code interpreter" tool. Plain chat-completions with structured output only.

### 1.5 Existing Phase 1 surface (unchanged)

- Gitleaks (`--redact` mandatory), OSV-Scanner, Semgrep custom rules.
- Phase 1 deterministic agents continue to run on every scan, regardless of mode.

---

## §2 Operating Modes (extends `phase-1/PHASE_1_PLAN.md §2`)

Phase 1 implemented `read_only_evidence`. Phase 2 adds `sandbox_active_validation`. Mode C (`approved_production_safe`) remains deferred — see `FPP §17 Phase 5` for its product-rollout placement. Phase 2 must keep its CLI rejection in place.

### Mode A — `read_only_evidence` (Phase 1, unchanged)

No change. Continues to be the default. Continues to work in every environment.

### Mode B — `sandbox_active_validation` (NEW)

Activated by:

```
veyra scan \
  --mode sandbox_active_validation \
  --env <local|dev|preview|staging|sandbox> \
  --supabase-sandbox <project_ref> \
  --supabase-service-role-key <env_var_name> \
  --approve-active \
  --project <path>
```

Mandatory at parse time:

- `--env` is not `production`.
- `--supabase-sandbox <project_ref>` is set. The project_ref must differ from any read-only Supabase project the scan would otherwise read.
- `--supabase-service-role-key` names an environment variable. The key itself is never accepted on the command line.
- `--approve-active` is present. The CLI also prompts interactively for a typed confirmation (`yes-i-understand-this-mutates-sandbox`) unless `--ci` is set, in which case the approval must come from a signed approval file.

Runtime behavior:

1. CLI validates the policy and writes a `scan-plan.json` artifact (per §3.1).
2. CLI shows the plan to the user and waits for confirmation, OR reads the signed approval file when `--ci`.
3. Scan proceeds through the five-phase active flow in §3.
4. On any cleanup failure, scan exits non-zero with a residual report; no `proven_in_sandbox` claims are emitted.

### Mode C — `approved_production_safe` (still deferred)

CLI continues to reject this mode with "not yet implemented." Phase 2 does not implement it. In the product-rollout phasing (`FINAL_PRODUCT_PLAN §17`), the relevant capability lands in Phase 5 ("safe live-product validation"). Internally we sometimes refer to it as "validation-mode Phase 3" — same thing, different phasing axis. The two numbering systems are reconciled by name (`approved_production_safe`), not by phase number.

---

## §3 Active Validation Flow (Plan → Synthesize → Exercise → Cleanup → Prove)

Every Phase 2 scan in Mode B passes through five phases in order. Each phase has a distinct artifact, distinct failure modes, and distinct rollback rules.

### 3.1 Plan

- Each agent that supports active validation (see §4.x) emits a `TestPlanEntry` declaring: test ID, control ID, required synthetic resources, expected outcome, max-duration.
- The orchestrator collects entries into a single `scan-plan.json` artifact.
- Plan is shown to the user before any mutation. No mutation happens in this phase.
- Plan budget caps: max synthetic identities, max tenants, max records — set by `SyntheticDataPolicy` and enforced at plan time.

### 3.2 Synthesize

- `synthetic-data-manager` agent reads the plan and provisions resources via Supabase Admin API.
- All resources tagged with `veyra_scan_id = <scan_uuid>`. Metadata column or dedicated schema — see §6.
- Synthetic identities use throwaway emails under a reserved domain (e.g. `veyra-synth-<scan_id>@veyra.invalid`). Passwords generated and stored only in memory.
- Synthesize phase is **all-or-nothing**: if a single resource fails to create, the manager rolls back everything created so far and aborts the scan before exercise begins.

### 3.3 Exercise

- `sandbox-runner` agent loads the test plan and runs each test against the application's actual endpoints (HTTP) or the Supabase data path (using the synthetic identity's JWT).
- Each test produces an `ActiveValidationResult` with outcome `proven_denial | proven_allowed | inconclusive`.
- A `proven_denial` is the strongest evidence Veyra can produce: it shows the application denied a specific synthetic actor under a specific synthetic scenario.
- A `proven_allowed` outcome on a sensitive endpoint is a `confirmed_issue` (direct evidence). This is the **only** Phase 2 path that legitimately emits `confirmed_issue`.

### 3.4 Cleanup

- `synthetic-data-manager` reverses every resource created in Synthesize.
- Verification: a `residual_count` query (using the same scan_id tag) must return zero. Non-zero residual → cleanup failure.
- Cleanup is run **even if Exercise crashed**. The orchestrator wraps Exercise in a try-finally.
- Cleanup proof artifact: `cleanup-proof.json` with `{ scan_id, created_count, deleted_count, residual_count, duration_ms, per_resource_log }`.

### 3.5 Prove

- `evidence-report` agent (Phase 1's, extended) consumes `ActiveValidationResult[]` and `cleanup-proof.json`.
- Controls with at least one `proven_denial` and a passing cleanup proof have their `readiness_status` upgraded from `evidence_present` (Phase 1) to `proven_in_sandbox` (Phase 2).
- Controls with `proven_allowed` outcomes are recorded as `confirmed_issue + fix_before_launch` and produce a `launch_blocker`.

---

## §4 Agent Architecture Updates

Phase 1's seven agents continue to run on every scan. Phase 2 adds three new agents and extends three existing ones.

### 4.0 Runtime updates

- The orchestrator becomes a **two-phase scan runner**: setup phase (Plan + Synthesize) and execution phase (Exercise + Cleanup + Prove). Cleanup is guaranteed via try-finally even on agent crash inside Exercise.
- Failure isolation rule from Phase 1 (`§4.0`: agents do not call each other; one crashing does not block others) is preserved for the Plan and Prove sub-phases. Synthesize and Cleanup are owned by a single agent (`synthetic-data-manager`) and are NOT independent — a crash there aborts the scan.
- The orchestrator produces a `scan-actions.log` artifact: every state-changing action (Supabase Admin API call, AI prompt, scanner subprocess) is recorded with timestamp, args fingerprint, and outcome. This is the auditability spine for Phase 2.

### 4.8 `synthetic-data-manager` (NEW agent)

- **Purpose**: Owns the synthesize + cleanup phases. Single responsibility, single failure boundary.
- **Inputs**: `scan-plan.json`, `ValidationPolicy`, Supabase service-role key (from env var).
- **Outputs**: `synthetic-resources.json` (the inventory), `cleanup-proof.json` (the receipt).
- **Controls**: Never touches a resource it didn't create. Never reads pre-existing user data. Cleanup runs even on partial synthesize failure.

### 4.9 `sandbox-runner` (NEW agent)

- **Purpose**: Executes the test plan. Each test = one HTTP call (or one Supabase data-path call) using a synthetic identity's JWT.
- **Inputs**: `scan-plan.json`, `synthetic-resources.json` (so it knows which identities exist).
- **Outputs**: `active-validation-results.json` (one entry per executed test).
- **Controls**: Does not mutate state outside what the test plan declared. Does not use service-role key — uses the JWT of the relevant synthetic identity. Tests are bounded in time (per-test timeout, per-scan budget).

### 4.10 `ai-explainer` (NEW agent)

- **Purpose**: Adds plain-language explanation and refined suggested-tests to existing findings. Never classifies, never makes a fix/block decision.
- **Inputs**: Every prior agent's findings + the canonical control catalog + `declared-context.json` from product-understanding.
- **Outputs**: `ai-enrichments.json` — keyed by `finding_id`, each entry contains `{ explanation, suggested_tests_refined, confidence, uncertainty_notes }`.
- **Controls**: All input is sanitized (no raw secrets, no raw user data, no synthetic passwords). Provider adapter is structured-output only. Every output has `confidence` and `uncertainty_notes` (per `PHASE_1_PLAN §4.7`). Disabled when `--no-ai`.

### 4.x Extended agents

- **`authn`** — declares active tests for: (a) accessing protected endpoint with no auth, (b) accessing admin endpoint as a non-admin synthetic identity. Reads back results, upgrades `likely_issue` to `confirmed_issue` only on `proven_allowed`.
- **`authz-tenant`** — declares active tests for: (a) cross-tenant object read, (b) client-provided `tenant_id` override, (c) cross-tenant file access. Same classification upgrade rule.
- **`supabase-rls`** — declares active tests for: (a) cross-tenant SELECT under the synthetic identity's JWT (proves RLS effectiveness), (b) anonymous SELECT on supposedly-private buckets. Schema-side findings from Phase 1 are now corroborated or contradicted by active outcomes.
- **`business-logic`** — declares active tests for declared workflows where data is available (e.g. self-approval, invitations, refund flows). Many business-logic concerns remain `coverage_gap` because no synthetic scenario can prove them without ambiguous-intent assumptions.
- **`evidence-report`** — adds the `proven_in_sandbox` path. Renders cleanup proof. Drives the `--fail-on-blocker` exit code, now including `proven_allowed` outcomes.

---

## §5 Finding Model Extensions

### 5.1 Evidence kinds wired in Phase 2

The discriminated union declared in `phase-1/steps/02-foundation-types-artifact-store-policy.md` is extended at runtime:

- `{ source: 'active_validation', test_id, outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive', synthetic_data_refs[] }` — now emitted by `sandbox-runner`.
- `{ source: 'cleanup_proof', scan_id, residual_count }` — now emitted by `synthetic-data-manager`.

### 5.2 Readiness status

- `proven_in_sandbox` (reserved in Phase 1) is now emitted by `evidence-report` when: at least one `proven_denial` exists for the control AND `cleanup-proof.json` shows `residual_count: 0`.
- `launch_blocker` is now emitted on: any `confirmed_issue + fix_before_launch` (Phase 1), OR any high-confidence `likely_issue + fix_before_launch` (Phase 1), OR any `proven_allowed` outcome on a sensitive endpoint (NEW Phase 2 path).

### 5.3 New finding-classification rule (Phase 2 only)

- `confirmed_issue` is permitted when and only when an `active_validation` evidence item with `outcome: 'proven_allowed'` exists for the finding. This is the single allowed promotion from `likely_issue` to `confirmed_issue` in Phase 2. AI cannot promote classification.

### 5.4 What does NOT change

- `Finding.finding_type` enum stays the same.
- `evidence_strength` enum stays the same.
- `blast_radius` enum stays the same.
- `review_action` enum stays the same.
- The Phase 1 §9 allowed-claims vocabulary is unchanged. `proven_in_sandbox` is a readiness status, not a claim that the app is "secure" or "safe."

---

## §6 Required and Not Required Deliverables

### 6.1 Required (Phase 2)

- `ActionExecutor` interface in `src/core/policy/executors/types.ts` + `SandboxExecutor` implementation in `src/core/policy/executors/sandbox/`.
- Synthetic-data-manager agent at `src/agents/synthetic-data-manager/`.
- Sandbox-runner agent at `src/agents/sandbox-runner/`.
- AI-explainer agent at `src/agents/ai-explainer/`.
- AI provider adapter: `src/ai/anthropic.ts` and `src/ai/openai.ts` behind a shared `AiProvider` interface at `src/ai/types.ts`.
- Negative-test catalog: `src/agents/sandbox-runner/test-catalog/` with one file per parameterized test (`cross-tenant-read`, `cross-tenant-write`, `client-tenant-id-override`, `anon-to-private-bucket`, `non-admin-to-admin-route`, etc.).
- The five deferred Phase 1 types land in `src/types/active-validation.ts`: `TestIdentity`, `TestTenant`, `TestRecord`, `SyntheticDataPolicy`, `CleanupPolicy`, `ActiveValidationResult`. Plus `ActionExecutor` in the policy types file.
- CLI updates: `--mode sandbox_active_validation` is now accepted; `--supabase-sandbox`, `--supabase-service-role-key`, `--approve-active`, `--ci`, `--no-ai`, `--ai-provider`, `--ai-model` are wired.
- Runtime confirmation prompt (or signed approval file in CI).
- Reporter updates: render `active_validation` evidence kind, render `cleanup_proof`, render the `proven_in_sandbox` status, render AI-enriched explanations distinctly from deterministic findings (per `PHASE_1_PLAN §3 Step 4`).
- Extended fixture: a disposable Supabase project (or recorded fixture set) that the vulnerable Lovable+Supabase app can target.
- Phase 2 docs: `docs/active-validation.md`, `docs/synthetic-data-and-cleanup.md`, `docs/ai-explanations.md`, `docs/approval-flow.md`.

### 6.2 Not Required (binding — stop and ask before adding)

- Production active validation. Mode C remains deferred.
- Autonomous remediation, auto-fix, auto-merge.
- AI that classifies findings, decides what to block, or generates SQL/code to run.
- Brute force / credential testing / password spraying.
- Cross-customer testing (only same-scan synthetic actors).
- Hosted dashboards, Slack, GitHub PR comments. (Phase 1 §6 / FPP §18 non-goals carry forward.)
- Compliance claims (DORA/GDPR/NIS2/SOC2). (Phase 1 §9 carries forward.)
- Multi-AI-provider consensus / arbitration. One provider per scan.
- AI tool-use loops that take actions.
- Long-running scans. Phase 2 caps the active phase at 5 minutes wall-clock by default; configurable up to 15.

---

## §7 First Implementation Tasks

Tasks are listed in dependency order. The phase-2 step files (under `phases/phase-2/steps/`, mirroring Phase 1's structure) will break each task down.

1. **Land deferred types.** Fill in `src/types/active-validation.ts` with `TestIdentity`, `TestTenant`, `TestRecord`, `SyntheticDataPolicy`, `CleanupPolicy`, `ActiveValidationResult`. Add `ActionExecutor` interface.
2. **SandboxExecutor + policy updates.** Implement `SandboxExecutor` behind the executor interface. Update `tool-policy.ts` so `sandbox_active_validation` mode actually populates `allowed_actions` for synthetic-data operations.
3. **AI provider adapter.** Shared `AiProvider` interface + Anthropic + OpenAI implementations. Sanitization helpers (`redactSecrets`, `stripRawData`). Prompt caching enabled on system + control-catalog prompts.
4. **synthetic-data-manager agent.** Owns Synthesize + Cleanup. Hard-fails on partial cleanup.
5. **Negative-test catalog.** One parameterized test per Phase 2 control. Tests are pure functions of (synthetic_resources, target_endpoint).
6. **sandbox-runner agent.** Loads plan, executes catalog tests, emits `active-validation-results.json`.
7. **ai-explainer agent.** Sanitized prompts, structured output, confidence labelling. Disabled when `--no-ai`.
8. **Extend Phase 1 agents.** Each emits `TestPlanEntry[]` during the Plan phase + reads back results during Prove.
9. **CLI updates.** Accept Mode B, wire all new flags, runtime confirmation, signed approval reader, exit-code logic.
10. **Reporter updates.** Render new evidence kinds, render `proven_in_sandbox`, render AI-enriched explanations distinctly, render cleanup proof.
11. **Fixture extension.** Disposable Supabase project (real or recorded) so the existing `examples/vulnerable-lovable-supabase/` can be targeted in Mode B. Plus expected `proven_denial` / `proven_allowed` outcomes per control.
12. **Documentation.** Four docs listed in §6.1. Pass `output-language-lint`.

---

## §8 Success Criteria

Phase 2 is done when **all** of the following hold against the extended vulnerable fixture:

- A scan with `--mode sandbox_active_validation` against the disposable sandbox produces at least:
  - For `§11.5`: `proven_allowed` on the RLS-off fixture variant (cross-tenant SELECT succeeds because RLS is disabled — proves the gap), AND `proven_denial` on the RLS-on fixture variant (cross-tenant SELECT denied — proves the control works when enabled). Two fixture variants or one parameterized variant; either is fine.
  - One `proven_allowed` for the seeded `§11.6` `USING (true)` policy table (cross-tenant SELECT succeeds — proves the policy is broken).
  - One `proven_allowed` for the seeded `§11.12` public bucket (anon download succeeds).
  - One `proven_allowed` for `§11.4` client-provided `tenant_id` override.
  - One `proven_denial` or `proven_allowed` for `§11.3` direct-object-access, depending on how the fixture is parameterized.
- `cleanup-proof.json` shows `residual_count: 0` for every resource type.
- The report renders AI-enriched explanations under a distinct heading from deterministic findings. Each AI output has `confidence` and `uncertainty_notes`.
- `--no-ai` produces a complete report (no AI section), and all deterministic + active findings still surface.
- `--mode sandbox_active_validation --env production` is rejected at parse time with a clear message.
- `--mode sandbox_active_validation` without `--approve-active` is rejected at parse time.
- The `scan-actions.log` artifact records every Supabase Admin API call, every AI prompt, and every scanner subprocess, with redacted args fingerprints.
- An induced cleanup failure (kill the manager mid-cleanup) results in non-zero exit, a residual report, and NO `proven_in_sandbox` claims in the output.
- `output-language-lint` returns zero hits across the report.

---

## §9 Explicit Non-Claims (extends `phase-1/PHASE_1_PLAN.md §9`)

In addition to Phase 1's non-claims, Phase 2 explicitly does NOT claim:

- An application is "secure" because a control was `proven_in_sandbox`. The claim is narrower: under this specific synthetic scenario, the application denied this specific synthetic actor at this specific moment in time. Behaviors may differ in production.
- An AI explanation is authoritative. AI outputs are suggestions to a human reviewer.
- Cleanup proof is a database audit. It is Veyra's own bookkeeping. A determined adversary or a malicious migration could leave residue Veyra cannot see.
- A `proven_denial` count translates to compliance. It does not.
- Active validation replaces a human security review. It supplements one.

Allowed Phase 2 language (extends Phase 1 §9):

- "The control was actively tested under synthetic scenario X."
- "The control denied the test actor in scenario X."
- "The control allowed the test actor in scenario X — appears launch-blocking."
- "AI-suggested explanation; needs human review."
- "Cleanup verified: residual_count = 0 for resources tagged with scan_id Y."

Forbidden Phase 2 language (extends Phase 1 §9):

- "The application is secure."
- "RLS works." → use "RLS denied the test actor in scenario X."
- "All controls passed." → use "Each of the N controls had at least one `proven_denial` outcome."

---

## §10 AI Integration Discipline

Phase 2 is the first time Veyra makes outbound AI calls. The discipline is non-negotiable.

### 10.1 What AI is used for

- **Finding explanations.** Plain-language description of impact and direction-of-fix, attached to each deterministic or active-validation finding. Sanitized input.
- **Suggested-test refinement.** The deterministic checklist from Phase 1 step 12 + extended Phase 2 catalog produces test stubs; AI rewrites them in clearer language and fills in domain-appropriate context based on `declared-context.json`.
- **Control-card narrative.** A short paragraph per control card summarizing the evidence picture.

### 10.2 What AI is NOT used for (binding)

- **Classification.** `finding_type`, `evidence_strength`, `review_action`, `blast_radius`, `readiness_status` — all deterministic. AI never sets these.
- **Decisions.** Whether to block a launch, whether to fix a finding, whether a control is "good enough" — all deterministic or human.
- **Generating executable artifacts.** AI does not generate SQL, code, migrations, or shell commands that Veyra executes.
- **Tool-use loops.** Phase 2 uses chat-completions with structured output only. No agentic loops that take actions.
- **Active-test generation.** The test catalog is checked in; AI does not invent new active tests at runtime.

### 10.3 Sanitization (mandatory)

Before any AI call:

- Redact secret-like patterns (re-use Gitleaks regexes + custom rules) from every input.
- Strip raw user-data fields: no PII, no email addresses, no synthetic identity passwords.
- Strip JWTs, access tokens, refresh tokens, service-role keys.
- Strip file contents that contain credentials — pass only file paths + truncated context windows around the finding.
- Prompts are templated; user input does not appear inside the prompt verbatim.

### 10.4 Prompt caching

- System prompt + canonical control catalog cached. Cache TTL aligned with the provider's cache window.
- Prompt cache hit ratio is tracked in the `scan-actions.log` artifact.
- A cache miss is not a failure — but it costs more, and the report's Sources section shows the spend per scan.

### 10.5 Confidence and uncertainty

- Every AI output has `confidence: 'low' | 'medium' | 'high'` and a free-text `uncertainty_notes` field.
- The reporter renders findings with `confidence: 'low'` under an explicit "AI-suggested, low confidence" subheading.
- AI output with no claims about a finding (e.g. "I cannot tell from this evidence") is preserved verbatim, not suppressed.

### 10.6 Model choice

- Default model: `claude-sonnet-4-6` for cost/quality balance.
- Optional opt-in: `claude-opus-4-7` for high-stakes scans, via `--ai-model`.
- `claude-haiku-4-5` for high-volume / CI scans.
- OpenAI fallback: `gpt-4o-mini` for cost-equivalence, `gpt-4o` for quality-equivalence.
- Knowledge-cutoff awareness: every AI output is labelled with the model id and the model's training cutoff. Findings that depend on current ecosystem knowledge (e.g. "is `axios@0.21.0` still vulnerable?") fall back to the deterministic OSV scanner; AI does not author the answer.

---

## §11 Trust Model Updates

### 11.1 Approval flow

- Interactive scans: typed confirmation (`yes-i-understand-this-mutates-sandbox`) before Synthesize begins.
- CI scans: signed approval file consumed via `--ci --approval-file <path>`. File is a JSON document with `{ scan_id_prefix, granted_at, granted_by, scope: { project_ref, max_synthetic_records, expires_at } }`. Approval file is single-use — Veyra writes a consumption marker to the artifact store and refuses to reuse the same file.
- The approval scope is enforced at plan time: if the plan exceeds the approved `max_synthetic_records`, scan aborts before Synthesize.

### 11.2 Synthetic data namespace

- All synthetic resources tagged with `veyra_scan_id` AND a fixed prefix (`veyra-synth-<scan_id>-`) on names where applicable.
- `synthetic_data_manager` refuses to operate against a project whose existing data already contains rows with that prefix (assumed orphan from a prior failed scan — operator must clean manually first).

### 11.3 Cleanup proof

- Cleanup is run unconditionally after Exercise, even on crash.
- Cleanup proof includes per-resource verification: list of expected deletions, list of actual deletions, residual count by resource type.
- Residual_count > 0 results in: non-zero exit, residual report file, NO `proven_in_sandbox` claims, AND a `confirmed_issue + fix_before_launch` finding flagging the failed cleanup.

### 11.4 Auditability

- `scan-actions.log` is the audit spine. Every state-changing call is recorded.
- Log entries include args fingerprint (SHA-256), not args themselves. Service-role keys, JWTs, passwords never appear in the log.
- The log is rendered in the report's Sources section as a summary (counts per action type) with the full log available as a separate artifact.

---

## §12 Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Synthetic data leaks into production. | `--env production` rejected at parse time for Mode B. `project_ref` for sandbox must differ from any other Supabase reference in the scan. Approval file scope binds to a specific `project_ref`. |
| Cleanup failure leaves residual records. | Cleanup is verified by residual_count. Failure produces non-zero exit, residual report, NO proven claims, AND a `confirmed_issue` finding. Manual cleanup procedure documented in `docs/synthetic-data-and-cleanup.md`. |
| Service-role key leakage. | Key accepted only via env var name, never on command line. Key never appears in artifacts, logs, AI prompts, or reports. Args fingerprints are SHA-256, not raw. |
| AI hallucination of vulnerabilities. | Classification stays deterministic. AI output is enrichment, not authority. Confidence required on every output. Reporter renders AI section distinctly. `--no-ai` produces a complete report. |
| AI prompt injection from project content. | Sanitization: project content is treated as data, never as instructions. Structured-output mode (Anthropic tool_use or OpenAI response_format) so the model returns typed JSON, not free-form text that could include directives. |
| Synthetic identity password leakage. | Passwords generated in memory, used once for sign-in, never logged, never persisted, never sent to AI. Identities deleted in Cleanup. |
| Test catalog drift from canonical controls. | Test catalog filenames keyed by `control_id` from `controls.ts`. Build fails if a catalog entry references a non-existent control_id. |
| Active validation produces false positives. | `proven_allowed` requires a successful HTTP / data-path response with a specific assertion (e.g. "returned row count > 0 AND row.tenant_id != test_actor.tenant_id"). Vague responses → `inconclusive`, not `proven_allowed`. |
| User believes `proven_in_sandbox` = "secure." | Reporter language fixed at §9. Docs explicitly state the bounded claim. README and the Sources section reinforce it. |
| Long scan duration. | Per-test timeout, per-scan wall-clock cap (5 min default), max-resources cap from `SyntheticDataPolicy`. CLI reports remaining budget. |
| MCP cost / quota exhaustion. | Phase 1 MCP discipline unchanged. Phase 2 does not add MCP traffic in the active phase — Supabase mutations go through Admin SDK, not MCP. |
| Concurrent scans race on synthetic data. | Each scan has a unique `scan_id` UUID; namespace prefix includes it. Two scans against the same sandbox project produce disjoint resource sets. |

---

## §13 Migration from Phase 1

What carries over without change:

- All 20 Phase 1 step files. Phase 1 agents continue to run as deterministic backbone.
- `phase-1/steps/02-foundation-types-artifact-store-policy.md` types (incl. `ValidationPolicy`, `EvidenceKind` discriminated union, the reserved `proven_in_sandbox` readiness value).
- `phase-1/steps/16-connector-supabase-mcp.md` Supabase MCP connector (read-only path).
- `phase-1/steps/15-connector-lovable-mcp.md` Lovable MCP connector.
- All Phase 1 scanner adapters (gitleaks, osv, semgrep).
- The `controls.ts` canonical catalog from `phase-1/steps/14-agent-evidence-report.md`. Phase 2 adds entries for controls that support active validation but does not renumber existing ones.

What needs explicit Phase 2 updates in Phase 1 files:

- `phase-1/steps/02-foundation-types-artifact-store-policy.md` — `src/types/active-validation.ts` is filled in (was an intentional placeholder).
- `phase-1/steps/03-cli-argv-and-dual-mode.md` — `--mode sandbox_active_validation` no longer rejects; `--mode approved_production_safe` still rejects.
- `phase-1/steps/13-reporter-markdown-and-json.md` — `active-validation.ts` and `cleanup-proof.ts` renderers go from "Phase 2 placeholder" to "implemented."
- `phase-1/steps/14-agent-evidence-report.md` — `readiness.ts` rules extended to include `proven_in_sandbox` and the `proven_allowed → confirmed_issue + launch_blocker` path.

What the AI-feedback F4 resolution is, finally:

- Phase 1 stays deterministic. The `PHASE_1_PLAN.md §3 Step 4 "AI Security Reasoning"` capability is moved to Phase 2 under `§10` of this plan. The Phase 1 alignment header already references this redirection; do not implement AI in Phase 1.

What this plan does NOT promise:

- A design for the production-safe validation mode. That capability lives in `FPP §17 Phase 5` and has its own design challenges (rate limiting, approval audit trail, blast-radius constraints) — out of scope here.
- A timeline. This plan is task-shaped, not date-shaped.

---

## §14 What's next

After this plan lands:

1. Spawn the phase-planner agent against this document to produce a `phases/phase-2/steps/` breakdown analogous to Phase 1's 20 step files.
2. Resolve any blocking decisions surfaced by that planner pass (likely: which AI provider ships first; whether the Supabase sandbox is a live disposable project or a recorded fixture; whether the approval-file format follows an existing standard).
3. Confirm `phase-1/PHASE_1_PLAN.md §3 Step 4 "AI Security Reasoning — deferred to Phase 2"` references this document for the AI capability move (already done as part of the 2026-05-24 alignment pass).
4. Begin step 01 of Phase 2 (Land deferred types).
