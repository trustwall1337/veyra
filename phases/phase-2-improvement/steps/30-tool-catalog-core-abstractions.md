# Step 30 — Tool catalog core abstractions + in-loop ToolResult base (no concrete tools in core)

**Status:** done (2026-05-27)
**Maps to:** `PLAN.md §B` (tool catalog + placement rule), `§C` (ToolResult), `§D.2` (classification ban), `§F`/`§K` (new ArtifactKinds)
**Phase:** 3 (Agentic Veyra), Cut 1
**Produces:** `src/core/tools/` abstractions ONLY — `ToolId` (opaque brand), `ToolDescriptor` type, registry contract, `src/types/tool-result.ts` (in-loop `ToolResult` base + recursive classification-key guard); additive `ArtifactKind` entries.
**Depends on:** none (first Phase 3 step)
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; new tests assert (a) `@ts-expect-error` a `ToolResult` with a top-level classification key does not compile; (b) `.strict()` parse rejects a result carrying `finding_type`/`review_action`/`evidence_strength`/`blast_radius`/`reproducibility` at ANY nesting depth; (c) `no-cross-layer-imports.test.ts` stays green (no concrete tool imported into `src/core`); (d) ArtifactKind exhaustiveness test covers the new kinds.

## Goal

Land the agentic loop's type substrate without any concrete tool. `src/core/tools/` owns only the contract: `ToolId`, `ToolDescriptor {tool_id, title, args_schema, result_schema, required_action, invoke}`, and the registry that resolves a `ToolId` to a descriptor. The in-loop `ToolResult` base type makes classification keys un-representable — both at compile time (exact shape + `Exclude` guard) and at runtime (`.strict()` + a whitelist-only fact-payload shape, with a belt-and-suspenders recursive deny-walk test). This is the mechanical guarantee codex required: a tool literally cannot return a Finding-shaped object.

## What lands

- `src/core/tools/tool-id.ts` — opaque branded `ToolId`.
- `src/core/tools/descriptor.ts` — `ToolDescriptor` type; `descriptors()` exposes id+title+args_schema only (never `invoke`).
- `src/core/tools/registry.ts` — `Map<ToolId, ToolDescriptor>` resolve; duplicate-id throws at registration; no central switch.
- `src/types/tool-result.ts` — `ToolResult` base: whitelist-only fact-payload shape; classification keys not assignable; recursive runtime guard helper.
- `src/types/artifact.ts` — additive `ArtifactKind`: `loop_trace`, `tool_error`, `tool_result_reject`, `required_evidence_ledger`, `redaction_alias_map`. `src/core/artifacts/artifact-store.ts` basename mappings for each.
- Tests per Verification.

## Done when

All Verification assertions pass. `src/core` imports nothing from `src/agents`/`src/connectors`/`src/scanners`. No concrete tool exists yet (that's Step 33).

## Guardrails

- Per CLAUDE.md §Architecture + `no-cross-layer-imports`: core owns abstractions only. Concrete descriptors live in leaf folders (Step 33).
- Per FPP §2A: `ToolId` opaque; registry-based resolution; no closed union of tool ids.
- ArtifactKind additions are additive — no existing kind renamed.

## D6 sub-agent delta (per `PLAN.md §O`)

This step also lands the sub-agent type surface (additive): the `spawn_deep_dive` arm on the proposal union; the closed typed `TargetDescriptor` discriminated union (one target, no free text — provider-agnostic in core); the `DEEP_DIVE_SCOPE_TABLE` checked-in literal (actions not tool-ids; CI-pinned row count); `ArtifactKind: subagent_error`; and **source-module metadata on registered descriptors** so the §D.2(iii) import-graph walk can derive entrypoints from the exact registry object (transitive + type-only imports). No behavior — types + registration surface only.

## References

- `PLAN.md §B` placement rule, `§C`, `§D.2`, `§F`, `§K`, `§O`
- `src/types/artifact.ts`, `src/core/artifacts/artifact-store.ts`, `src/types/no-cross-layer-imports.test.ts`
