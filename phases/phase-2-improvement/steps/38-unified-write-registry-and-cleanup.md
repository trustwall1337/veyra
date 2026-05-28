# Step 38 — Unified write registry + cleanup reverse-walk (both write paths)

**Status:** not started
**Maps to:** `PLAN.md §D.3` (both write paths), `decisions.md` D1
**Phase:** 3, Cut 3
**Produces:** `src/core/sandbox/http-write-registry.ts` + `executeWriteWithRegistry()` (sole HTTP write entry, Path 1); a unified `WriteRegistry` contract wrapping both Path 1 (HTTP `transport.send`) and Path 2 (Admin-SDK synthetic-resource registry, `synthetic-data-manager/agent.ts:111`); post-loop cleanup reverse-walk over both → one `cleanup_proof`/`residual_count`; a lint guard rejecting direct mutating writes.
**Depends on:** 31
**Executed by:** plain coding pass + `mcp-policy-check` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) every state-changing HTTP call goes through `executeWriteWithRegistry()` (recorded BEFORE send); (b) a direct mutating `fetch()`/`transport.send()` outside the wrapper is a lint-blocking failure; (c) the Admin-SDK synthetic-resource registry (Path 2) is unified under the same `WriteRegistry` contract — cleanup reads both and produces one `residual_count`; (d) cleanup failure on EITHER path → a `cleanup_failed` launch-blocker finding; (e) a write-then-cleanup roundtrip across both paths returns `residual_count: 0`.

## Goal

Per D1, AI-authored writes ship ONLY behind a mandatory cleanup-aware registry covering both write paths, with no bypass. The HTTP path routes through `executeWriteWithRegistry()` (sole entry); the existing Admin-SDK synthetic-resource registry is kept and unified under one `WriteRegistry` so post-loop cleanup reverse-walks both and a failure on either is a launch-blocker.

## What lands

- `http-write-registry.ts` + `executeWriteWithRegistry()` (Path 1).
- Unify the existing Admin-SDK registry (Path 2) under one `WriteRegistry` contract; do NOT rewrite Admin creation logic.
- Post-loop cleanup reverse-walk over both → `cleanup_proof` with `residual_count`.
- Lint guard: direct mutating write outside the wrapper fails the build.
- Tests per Verification.

## Done when

All Verification assertions pass. A write-then-cleanup roundtrip (1 HTTP write + 1 synthetic user) leaves `residual_count: 0`; an induced cleanup failure surfaces a `cleanup_failed` launch-blocker.

## Guardrails

- Per D1: no bypass flag. `executeWriteWithRegistry()` is the sole HTTP write entry; direct mutating writes are lint failures.
- Per CLAUDE.md §Secrets: registry records redacted bodies only.
- Cleanup is deterministic and mandatory on crash (carried from Phase 2 step 14 two-phase discipline).

## References

- `PLAN.md §D.3`; `decisions.md` D1; `sandbox-runner/agent.ts:155` (Path 1), `synthetic-data-manager/agent.ts:111` (Path 2)
