# Step 34 — Loop-view redaction + audit trail (`loop-trace.jsonl`)

**Status:** done (2026-05-28)
**Maps to:** `PLAN.md §D.4` (loop-view redaction), `§F` (audit trail fields)
**Phase:** 3, Cut 1
**Produces:** `src/ai/ai-output-redaction.ts` (stable-alias redaction for tool results re-entering the loop view; carried from PLAN-v1 §D.C), `loop-trace.jsonl` writer (`ArtifactKind: loop_trace`).
**Depends on:** 31
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) tool results re-entering the AI loop view are redacted (stable aliases `REDACTED_<KIND>_<N>`, same resource → same alias within a scan) before AI sees them; (b) `loop-trace.jsonl` writes one append-only record per step with all §F fields: `step, recorded_at, model_id, prompt_fingerprint_sha256, proposal_kind, tool_id?, args_redacted?, gate_decision, gate_reason?, arg_validation, result_validation (accepted/rejected/n_a), result_reject_reason?, invoke_status, result_artifact_ref?, budget_snapshot, policy_snapshot_hash, descriptor_schema_version_hash, tool_duration_ms?, result_digest? (of redacted result), tool_error_class?, state_view_digest, alias_map_artifact_ref?`; (c) no raw secret in any trace field (digests/args over redacted data only); (d) a crash mid-loop leaves a complete trace up to the crash point (per-step write, not buffered).

## Goal

Make every AI decision reconstructable and defensible. Tool results are redacted (stable aliases) before re-entering the loop view so AI never sees a raw secret and the same resource is traceable across steps. The per-step trace records the policy + descriptor snapshot hashes so an auditor can prove what was in force when each decision was made.

## What lands

- `ai-output-redaction.ts` stable-alias redactor (URL / ID / TOKEN / EMAIL kinds, first-appearance ordinal, per-scan map persisted as `redaction-alias-map.json`).
- `loop-trace.jsonl` per-step append-only writer with all §F fields.
- Tests per Verification.

## Done when

All Verification assertions pass. An operator can read `loop-trace.jsonl` top-to-bottom and reconstruct every tool choice, gate decision, result acceptance/rejection, and the policy/descriptor in force per step.

## Guardrails

- Per CLAUDE.md §Secrets: no raw secret in trace/digests/alias-map; `result_digest` is the hash of the REDACTED parsed result.
- Append-only, per-step write — crash-safe.
- `args_redacted`/`result_digest` go through the same redactor; `ArtifactRef` citation ids are NOT redacted (internal ids, not customer secrets).

## D6 sub-agent delta (per `PLAN.md §O`)

The `loop-trace.jsonl` record gains four nullable sub-agent fields (additive): `parent_step` (the spawn step; `null` at depth 0), `subagent_id` (stable per spawned sub-agent), `subagent_target` (the redacted typed `TargetDescriptor`), `subagent_depth` (∈ {0,1}). A test asserts no trace row ever has `subagent_depth > 1`. An operator reconstructs a deep-dive by filtering on `subagent_id`. The `spawn_deep_dive` proposal logs as a normal parent step with `proposal_kind='spawn_deep_dive'` + the gate decision.

## References

- `PLAN.md §D.4`, `§F`, `§O`; PLAN-v1 §D.C (stable-alias mechanism carried); `decisions.md` D6
