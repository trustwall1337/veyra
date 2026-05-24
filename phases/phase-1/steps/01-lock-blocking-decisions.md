# Step 01 — Lock blocking decisions

**Status:** done (2026-05-24, commit f5534fe)
**Maps to:** `CLAUDE.md §Currently undecided` + planner research findings on Lovable/Supabase MCP surface
**Produces:** decision record + dependency pins in `package.json` + `CLAUDE.md` update
**Depends on:** none
**Executed by:** user (records picks; no code yet)
**Verification:** `pnpm typecheck` after `pnpm install`

## Goal

Resolve every open engineering choice that downstream steps depend on, so step 02 onward is a straight-line build. The planner already recommends a default for each; this step is for the user to ratify or override.

## Decisions to ratify

1. **Test framework: Vitest.** Already pinned in `package.json` (`vitest@4.1.7`). Update `CLAUDE.md §Currently undecided` to remove this entry. Runner-up: `node:test` — rejected because agent contract tests need snapshots and `vi.mock`.
2. **CLI argv lib: commander.** Mature, TS-native v13 generics, zero deps. Runner-up: `citty` — rejected because for a security CLI, maturity > novelty.
3. **MCP SDK: `@modelcontextprotocol/sdk` (official).** Node 18+/ESM, requires `zod` peer. Known issue #460 (ESM resolution) may need a `moduleResolution` workaround. Runner-up: hand-rolled JSON-RPC over `fetch` — fallback if SDK breaks at step 02.
4. **Supabase MCP `execute_sql` policy:** denied in Phase 1 even under `read_only=true`. Use `list_tables` + `get_advisors` instead. Per `PHASE_1_PLAN §4.4` "Do not query user data."
5. **Lovable MCP allowlist:** unchanged six tools per `PHASE_1_PLAN §3 Step 1`. Newly available tools (`list_projects`, `get_project_knowledge`, etc.) stay out until Phase 2.

## What lands

- `package.json` adds `commander`, `@modelcontextprotocol/sdk`, `zod` (peer dep of the SDK).
- `CLAUDE.md §Currently undecided` is removed or marked resolved.
- A short `phases/phase-1/decisions.md` (or appended to `CLAUDE.md`) records the chosen options and runners-up, so future Claude sessions don't relitigate.

## Done when

`CLAUDE.md` no longer lists undecided items, `package.json` pins the chosen deps, and `pnpm install && pnpm typecheck` succeeds.

## Guardrails

- Do not silently pick a different option. If the user overrides a recommendation, record it.
- Do not install `@modelcontextprotocol/sdk` without `zod` — the SDK requires it as a peer.
- Do not add any other dep at this step. New deps land with the step that needs them.

## References

- `CLAUDE.md` §Currently undecided + §Stack
- `PHASE_1_PLAN.md` §3 Step 1 (Lovable allowlist), §4.4 (Supabase controls)
- `@modelcontextprotocol/sdk` issue #460 (ESM resolution)
