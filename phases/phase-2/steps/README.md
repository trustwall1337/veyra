# Phase 2 — Step Files

Executable breakdown of `phases/phase-2/PHASE_2_PLAN.md` into **16 task steps spread across 20 files** (step 10 is split into 10a–10e, one file per agent extension). Derived from the phase-planner agent run (2026-05-24) against the Phase 2 plan, with web research on AI provider capabilities + Supabase Admin SDK semantics.

## Product framing carries over

From Phase 1: Veyra is a control-evidence platform. The CLI is the first delivery mechanism, not the product. Phase 2 adds mutation (sandbox-scoped only), active validation, and AI-assisted explanation.

## How to use these files

Same conventions as `phases/phase-1/steps/README.md`. Each file is self-contained: a future session should be able to pick up a step without re-reading the whole plan.

## Extensibility-first architecture (carries over from Phase 1)

Every Phase 2 capability lands behind the same opaque-ID + registry pattern as Phase 1, per `FINAL_PRODUCT_PLAN.md §2A`. The `SandboxExecutor` registers by `ConnectorId`. The synthetic-data-manager works against any registered adapter (Phase 2 ships Supabase only; future Firebase / Clerk adapters drop in without changing the manager contract). The negative-test catalog is keyed by `control_id`, not by provider. The `ai-explainer` is per-`EvidenceKind`, not per-connector.

## Hard rules (carry over from Phase 1 + Phase 2 additions)

Phase 1 hard rules unchanged. Phase 2 additions:

- **Mutation is sandbox-only.** `--env production` rejected at parse time for Mode B. The `SandboxExecutor` is not compiled into Mode A scans.
- **Synthetic data is namespaced and verifiable.** Every Veyra-created resource carries `veyra_scan_id` metadata. Cleanup verifies `residual_count: 0`. Cleanup failure → non-zero exit + residual report + a `confirmed_issue + fix_before_launch` finding flagging the failed cleanup.
- **`proven_allowed` is the ONLY path that promotes a finding to `confirmed_issue`.** AI cannot. Heuristics cannot. Only active-validation outcomes can.
- **AI never classifies.** AI generates explanations + refined suggested tests + control-card narrative. AI never sets `finding_type`, `evidence_strength`, `review_action`, `blast_radius`, `readiness_status`. AI never decides what to fix or what to block.
- **AI input is sanitized.** No raw secrets, no raw user data, no synthetic passwords, no JWTs. Per-call sanitization required by `PHASE_2_PLAN §10.3`.
- **`scan-actions.log` is the audit spine.** Every Supabase Admin call, every AI prompt, every test execution, every cleanup operation appends an entry with SHA-256 args fingerprint.
- **Service-role key never on argv.** `--supabase-service-role-key` accepts an env-var name only.

## Blocking decisions taken / pending

Recommended picks (planner; user ratifies in step 01):

- **AI provider order:** Anthropic first, OpenAI fallback second.
- **ActionExecutor birthplace:** Phase 1 step 02 stub (typed interface only; no implementation in Phase 1).
- **Prompt-cache TTL:** 5-minute default; `--ai-cache-ttl` opt-in to 1-hour.

User decisions pending:

- **Sandbox fixture form:** live disposable Supabase project vs recorded-fixture replay. Affects step 13.
- **Approval-file format:** minimal `{ scan_id_prefix, granted_at, granted_by, scope }` JSON with detached signature, OR in-toto/DSSE envelope. Signing tech also pending (cosign / minisign / sigstore). Affects step 11.
- **`/scan-fixture-active`:** new command vs extend `/scan-fixture`. Affects step 15.

## File index

| # | File | Title |
|---|---|---|
| 01 | `01-lock-phase2-blocking-decisions.md` | Lock Phase 2 blocking decisions |
| 02 | `02-land-deferred-types-and-action-executor.md` | Phase 2 deferred types + `ActionExecutor` interface |
| 03 | `03-sandbox-executor-and-policy-wiring.md` | `SandboxExecutor` + policy wiring for Mode B |
| 04 | `04-ai-provider-interface-and-anthropic-adapter.md` | AI provider interface + Anthropic adapter |
| 05 | `05-openai-fallback-adapter.md` | OpenAI fallback adapter |
| 06 | `06-synthetic-data-manager-agent.md` | `synthetic-data-manager` agent (Synthesize + Cleanup) |
| 07 | `07-negative-test-catalog.md` | Negative-test catalog keyed by `control_id` |
| 08 | `08-sandbox-runner-agent.md` | `sandbox-runner` agent (executes test plan) |
| 09 | `09-ai-explainer-agent.md` | `ai-explainer` agent (per-`EvidenceKind` enrichment) |
| 10a | `10a-extend-supabase-rls-agent-for-active.md` | Extend `supabase-rls` for active validation |
| 10b | `10b-extend-authz-tenant-agent-for-active.md` | Extend `authz-tenant` for active validation |
| 10c | `10c-extend-authn-agent-for-active.md` | Extend `authn` for active validation |
| 10d | `10d-extend-business-logic-agent-for-active.md` | Extend `business-logic` for active validation |
| 10e | `10e-extend-evidence-report-agent-and-readiness-rules.md` | Extend `evidence-report` + new readiness rules |
| 11 | `11-cli-mode-b-and-approval-flow.md` | CLI Mode B + approval flow |
| 12 | `12-reporter-active-validation-cleanup-ai.md` | Reporter: active-validation + cleanup-proof + AI sections |
| 13 | `13-fixture-extension-sandbox-and-expected-outcomes.md` | Fixture extension (sandbox + `expected-outcomes.json`) |
| 14 | `14-orchestrator-two-phase-runner-and-scan-actions-log.md` | Orchestrator two-phase runner + `scan-actions.log` |
| 15 | `15-phase2-fixture-validation-gate.md` | Phase 2 end-to-end fixture validation gate |
| 16 | `16-phase2-documentation.md` | Phase 2 documentation |
