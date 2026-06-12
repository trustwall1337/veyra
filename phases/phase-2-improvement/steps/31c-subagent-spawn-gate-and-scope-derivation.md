# Step 31c — Sub-agent spawn gate + sub-scope derivation (D6 deep-dive)

**Status:** done (2026-05-28)
**Maps to:** `PLAN.md §O` (deep-dive sub-agents), `decisions.md` D6
**Phase:** 3, Cut 1 (last item before 41-partial)
**Produces:** `policyGate.authorizeSpawn(proposal, policy, state, depth)` in `src/core/policy/` (the spawn-authorization half: depth-cap + policy + `TargetDescriptor` validation) + `deriveSubScope(target, parentScope, policy)` in `src/core/orchestrator/` (the scope-derivation half; reads only the catalog *contract*, so `src/core` stays import-clean).
**Depends on:** 30 (TargetDescriptor type + DEEP_DIVE_SCOPE_TABLE + spawn_deep_dive proposal arm), 31 (depth-aware runDeepDive + ChildBudget), 33 (registered catalog to subset)
**Executed by:** plain coding pass + `mcp-policy-check` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) **depth cap** — `authorizeSpawn` denies any spawn at `depth>=1`, recorded `spawn_denied(depth_cap)`; a sub-agent that proposes `spawn_deep_dive` never reaches a nested `runDeepDive`; (b) **strict subset vs parent scope** — `deriveSubScope` returns `⊊ parentScope`, `size < parentScope.size`, every member `===` a `parentScope` descriptor, every member's `required_action ∈ policy.allowed_actions`; errors (Result) on empty or non-proper-subset; (c) **Mode A write-free** — in `read_only_evidence` the derived subset contains no write tool (policy forbids write actions); (d) **no new tool** — the subset is filtered FROM parentScope, never augmented; (e) `no-cross-layer-imports.test.ts` stays green.

## Goal

Land the two deterministic mechanisms that make deep-dive sub-agents safe: the spawn gate (enforces the depth cap + policy + typed target) and the scope-derivation (the narrow, strict-subset tool menu). Both are deterministic; the gate is the single authority for whether a sub-agent may spawn and what it may see.

## What lands

- `authorizeSpawn(proposal, policy, state, depth)`: returns `denied(reason='depth_cap')` for `depth>=1`; validates `TargetDescriptor` (closed typed union, one target, no free text); applies the policy check. Lives in `src/core/policy/` alongside the existing gate.
- `deriveSubScope(target, parentScope, policy)`: pure function; looks up `target.kind` in `DEEP_DIVE_SCOPE_TABLE` (checked-in literal, actions not tool-ids, CI-pinned row count); filters `parentScope` by those actions ∩ `policy.allowed_actions`; asserts strict-subset + object-identity; returns `Result<ToolDescriptor[], ScopeError>`.
- Tests per Verification.

## Done when

All Verification assertions pass. A depth-0 spawn with a valid target yields a write-free (Mode A) strict-subset scope; a depth-1 spawn is denied; `src/core` stays import-clean.

## Guardrails

- Per D6.2: depth cap is one integer compare in the gate, not a convention.
- Per D6.3: subset derived from `parentScope`, never the global catalog augmented; no tool promotion via a sub-agent.
- Per D6.5: the subset is a menu; the per-call gate is the authority — a write tool in a subset the policy forbids is still denied per call.
- Per CLAUDE.md §Architecture: `TargetDescriptor` schemas + `DEEP_DIVE_SCOPE_TABLE` rows stay provider-agnostic in core (actions + opaque refs); provider-specific target shapes live in leaf folders.

## References

- `PLAN.md §O`; `decisions.md` D6; `src/core/policy/tool-policy.ts`; `src/types/validation-policy.ts`; `src/types/no-cross-layer-imports.test.ts`
