# Step 01 — Lock Phase 2 blocking decisions

**Status:** not started
**Maps to:** `PHASE_2_PLAN §6.1` + §11.1 + §10.6; `FINAL_PRODUCT_PLAN §17 Phase 2`
**Produces:** `phases/phase-2/decisions.md` + any new `package.json` pins (e.g. `@anthropic-ai/sdk`, `@supabase/supabase-js`, signing-tool dep TBD)
**Depends on:** none
**Executed by:** user (records picks; no code yet)
**Verification:** `phases/phase-2/decisions.md` committed; `package.json` pins parse; `pnpm install && pnpm typecheck` green

## Goal

Resolve every open engineering choice that downstream Phase 2 steps depend on, so step 02 onward is a straight-line build. The planner already recommends defaults for the lower-stakes items; this step is for the user to ratify or override and to settle the three load-bearing decisions.

## Decisions to ratify (planner picks; user confirms)

1. **AI provider order: Anthropic first.** Default model `claude-sonnet-4-6`. Land in step 04. OpenAI fallback in step 05. Runner-up: ship both adapters in step 04. Tradeoff: dependency isolation + the default ships first.
2. **`ActionExecutor` interface birthplace: Phase 1 step 02 (typed stub).** Phase 1 step 02 currently doesn't list it; minor edit adds the type definition there. Phase 2 step 02 then imports it. Runner-up: introduce it new in Phase 2 step 02. Tradeoff: keeps Phase 1 the canonical source of `src/core/policy/executors/types.ts`.
3. **Prompt-cache TTL: 5-minute default; `--ai-cache-ttl` to opt up to 1-hour.** Per Anthropic 2026 pricing, 1-hour cache is priced separately. Default to the cheap option; let the user opt up. Runner-up: 1-hour default. Tradeoff: cost vs cache hit rate; defaulting cheap is the safer floor.

## Decisions user must make (no recommendation strong enough to lock)

4. **Sandbox fixture form: live disposable Supabase project, OR recorded-fixture replay?**
   - **Live:** highest fidelity, requires owning a Supabase test project, introduces a network dependency in CI.
   - **Recorded:** deterministic, repeatable, freezes the Admin API contract at recording time.
   - Affects step 13. Either is workable; pick before step 13 lands.
5. **Approval-file format:**
   - **Option A (minimal):** `{ scan_id_prefix, granted_at, granted_by, scope: { project_ref, max_synthetic_records, expires_at } }` JSON with a detached signature (`cosign` / `minisign` / `sigstore` — pick one).
   - **Option B (heavyweight):** in-toto / DSSE attestation envelope.
   - Affects step 11 (CLI approval-file reader). Settle BEFORE step 11.
6. **`/scan-fixture-active` — new command, or extend `/scan-fixture`?**
   - **New command** keeps the Phase 1 deterministic gate frozen as a regression bar. Cleaner failure-isolation.
   - **Extend `/scan-fixture`** keeps one command.
   - Affects step 15. Either is workable.

## What lands

- `phases/phase-2/decisions.md` records: every blocking decision with chosen option, runner-up, and tradeoff. This is the canonical record future Claudes / phase-planner runs consult.
- `package.json` pins for the AI SDK (Anthropic + later OpenAI), `zod` (peer of Anthropic SDK), `@supabase/supabase-js` (Admin SDK), and the signing-tool dep once decision 5 lands.
- One-line update in `CLAUDE.md` removing any Phase 2 "currently undecided" entries that get resolved here.

## Done when

Every blocking decision in the planner's Phase 2 report has a recorded pick + runner-up + tradeoff in `phases/phase-2/decisions.md`. `pnpm install && pnpm typecheck` is green with the new deps.

## Guardrails

- Do not silently pick a different option. If the user overrides a recommendation, record it.
- Do not install AI SDKs without their peer dependencies (`zod` for Anthropic SDK).
- Do not introduce the signing tool dep before decision 5 is settled.
- Do not commit any AI API key, even an "expired test key." Service-role and AI keys are accepted via env-var only.

## References

- `PHASE_2_PLAN.md` §6.1 (Required deliverables), §10.6 (model choice), §11.1 (approval flow)
- `FINAL_PRODUCT_PLAN.md` §17 (Phase 2 roadmap)
- Planner blocking-decisions section (2026-05-24)
