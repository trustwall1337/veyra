# Step 17b — Deterministic Bootstrap Inventory (split of step 17)

**Status:** not started
**Maps to:** `REVISION_AI_SHAPE.md §1 layer 1, §7.1, §9 step 17 row`
**Amends Phase 1 step:** 17
**Produces:** deterministic module at `src/agents/product-understanding/inventory/`
**Depends on:** 02b
**Executed by:** `/new-agent` skill (amendment mode)
**Verification:** integration test against fixture produces `inventory-bootstrap.json` with `observed_evidence` fields only; no `declared_intent` field; local-only path works without MCP

## Goal

Split the original `product-understanding` agent into a **deterministic Bootstrap Inventory** that owns `observed_evidence` only. AI Product-Understanding (17c) runs alongside and contributes only `declared_intent`. The composer in 17c merges both into the final `declared-context.json`.

## What lands

- `src/agents/product-understanding/inventory/bootstrap.ts` — deterministic local-pass + MCP-pass (when enabled). Writes `inventory-bootstrap.json` with: file map, package.json digest, route-map extraction, framework detection (Vite/Next/etc.), env declarations, Supabase MCP-derived schema metadata when `--supabase-mcp` is set, Lovable MCP-derived file inventory when `--lovable-mcp` is set.
- Output artifact: `inventory-bootstrap.json`. Shape: `{ observed_evidence: { ... }, sources: [ ... ] }`. **No `declared_intent` field.**

## Done when

- `inventory-bootstrap.json` is produced on every scan (`--no-ai` or not).
- The module does not call any AI provider. Verified by import-graph test.
- The module does not write to `declared-context.json` directly — only to `inventory-bootstrap.json`. The composer (17c) is the sole writer of the final artifact.
- Local-only path (no MCP) produces a non-empty `observed_evidence` field.
- Integration test against fixture: same observed_evidence shape as the original step 17's `declared-context.json.observed_evidence` field.

## Guardrails

- **Constraint 8 enforced:** AI never populates `observed_evidence`. This module is deterministic and is the only producer.
- Per `FPP §2A`: file-detection and route-extraction logic uses extension/pattern matching from checked-in code, not hardcoded framework names in shared types. Adding a new framework = new pattern, no shared-type edit.
- Per `CLAUDE.md §TypeScript conventions`: no `any`. Expected-failure paths return `Result<T, E>`.
- The module is sized for one job (observation). Refactoring into multiple files is fine; mixing concerns is not.

## References

- `REVISION_AI_SHAPE.md` §1 layer 1, §7.1
- `phase-1/steps/17-agent-product-understanding.md` (original — was not done; superseded by this split)
