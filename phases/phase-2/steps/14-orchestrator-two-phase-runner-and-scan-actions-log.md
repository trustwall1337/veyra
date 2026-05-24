# Step 14 — Orchestrator two-phase runner + `scan-actions.log`

**Status:** not started
**Maps to:** `PHASE_2_PLAN §7 Task 2 (completion)`, §4.0, §11.4
**Produces:** infra (`src/core/orchestrator/scan-orchestrator.ts` extension + `src/core/audit/scan-actions-log.ts`)
**Depends on:** 06, 08, 09, 10e
**Executed by:** plain coding pass (+ `plan-adherence` to verify no cross-agent imports introduced)
**Verification:** integration test for Exercise crash → Cleanup still runs + `scan-actions.log` shows the crash entry; args-fingerprint test asserts no raw key/JWT/password is loggable

## Goal

Extend Phase 1's orchestrator (step 18) into a two-phase scan runner for Mode B. Add the `scan-actions.log` audit spine that every state-changing action writes into.

## What lands

### Two-phase orchestrator

- Setup phase: Plan (each agent declares `TestPlanEntry[]`) → user-facing plan review → Synthesize (`synthetic-data-manager` from step 06).
- Execution phase: Exercise (`sandbox-runner` from step 08) → Cleanup (`synthetic-data-manager`) → Prove (`evidence-report` extended in step 10e).
- Exercise is wrapped in try-finally: Cleanup runs even on Exercise crash.
- Plan-phase failure semantics: `coverage_gap` + scan aborts before mutation, exit non-zero.
- Synthesize-phase failure: manager rolls back resources it created, scan aborts before Exercise, exit non-zero.
- Exercise-phase failure: try-finally invokes Cleanup, scan exits non-zero, `active-validation-results.json` is partial.
- Cleanup-phase failure: non-zero exit + residual report + `confirmed_issue + fix_before_launch` finding.
- Prove-phase failure: report renders without upgrades; deterministic findings still surface.

### Audit spine

- `src/core/audit/scan-actions-log.ts` exposes `append(entry)` and `summarize()`.
- Entry shape: `{ timestamp, scan_id, action_id, args_fingerprint_sha256, outcome, duration_ms, action_type, context_tags? }`.
- Callers: `SandboxExecutor` (every Supabase Admin call), `AiProvider` adapters (every AI call), scanner adapters (every subprocess), MCP connectors (every tool call).
- Service-role keys, JWTs, passwords, raw secrets NEVER appear — only SHA-256 fingerprints.

## Done when

- Integration test: throw inside `sandbox-runner` mid-Exercise → assert Cleanup ran + `scan-actions.log` shows the crash + scan exited non-zero.
- Integration test: throw inside `synthetic-data-manager` mid-Synthesize → assert rollback + Cleanup → assert exit non-zero before Exercise.
- Args-fingerprint test: feed a known service-role key into a fake action → assert the raw key does NOT appear anywhere in `scan-actions.log` or in the artifact store; only its SHA-256 fingerprint.
- `plan-adherence` on the diff: zero new cross-agent imports.
- Phase 1 Mode A behavior unchanged: existing Phase 1 integration tests still pass.

## Guardrails

- Per `§4.0`: Synthesize + Cleanup are single-owned by `synthetic-data-manager`. Plan, Exercise, Prove are independently isolated (one crashing does not block independent agents in those sub-phases).
- Per `§11.4`: every state-changing action gets a log entry. Read-only actions also log (so the audit is complete).
- Per `§11.4`: args fingerprints are SHA-256. Plaintext is never persisted. Sanitization is layered: caller sanitizes input → adapter takes responsibility for fingerprinting before persisting.
- Per `FPP §2A`: orchestrator does not switch on connector/scanner/agent ids. It iterates registered services from the registry.
- Per `§10.6`: AI call entries record model id + version + cache hit ratio so a future model rollforward is auditable.

## References

- `PHASE_2_PLAN.md` §4.0 (runtime updates), §11.4 (auditability)
- Phase 1 step 18 (orchestrator baseline)
- `.claude/agents/plan-adherence.md`
- Step 06 manager, step 08 runner, step 09 explainer, step 10e evidence-report
