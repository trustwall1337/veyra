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
2. **`ActionExecutor` interface birthplace: Phase 1 step 02 (typed stub).** Phase 1 step 02 now lists it (as of the 2026-05-24 alignment pass) — `src/core/policy/executors/types.ts` is owned by Phase 1. Phase 2 step 02 imports it without modification. Runner-up: introduce it new in Phase 2 step 02. Decision settled; documented here so any future revisit has the trail.
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

## Phase-1-mistake preventer decisions (planner picks; user confirms)

Surfaced by the live Phase 1 validation runs on 2026-05-25 / 2026-05-26 that exposed two recurring patterns: (a) code that types-and-tests-passes against mocks but fails against real endpoints, (b) fixture-tight implementations that work on the seeded fixture but real dev/sandbox behavior is untested. These four decisions are locked here so downstream Phase 2 steps cannot drift into the same shape of bug.

7. **Real endpoint-transport smoke test required** in every Phase 2 step that wraps a real provider/client transport. Specifically: step 06 (Supabase Admin API), step 06b (`auth.signInWithPassword`), step 08 (PostgREST fetch), step 03 (sandbox executor). Each of those steps' Done-when must include either (i) a live-endpoint smoke test, env-var-gated so CI skips when secrets are absent — with the skip emitting an explicit `skipped_missing_env` result rather than passing silently — OR (ii) a recorded-from-real snapshot (real endpoint hit once, response replayed deterministically in tests) — never mock-only. At least one release gate must run live or refresh the recorded-from-real snapshot, so the snapshot cannot drift indefinitely. Runner-up: keep mock-only and ship; rejected because that's the exact pattern that produced Phase 1's `--supabase-mcp` no-op (step 24) and the parser-empty-on-real-dump bug (step 26).

8. **Representative dev/sandbox-project gate paired with the fixture gate (step 15).** Step 15's fixture validation gate is necessary but not sufficient: it must be paired with an end-to-end test against a representative dev/sandbox project outside the seeded happy fixture, or a sanitized recorded-from-real snapshot of one. Same shape as Phase 1 step 22's end-to-end gate, but for active validation. Step 15's Done-when explicitly takes a new assertion: the active-validation pipeline produces a non-empty `active-validation-results.json` against the representative-or-recorded input. Without this, the same "fixture passes, real dev/sandbox behavior is untested" pattern recurs. Runner-up: fixture-only gate; rejected because it's the exact mistake we just paid for in Phase 1 step 26.

9. **Catalog-bound executable-test universe in Phase 2.** Customers cannot author custom executable test *types* in Phase 2; they may only select / parameterize catalog entries that pass the compiler. The AI security planner (step 07b) is already constrained to the catalog by the `planner-output-is-subset-of-catalog` test; step 07c allows human-authored *plans* that still compile against the catalog. Step 16 (Phase 2 documentation) must state this distinction explicitly so customer expectation matches reality: "Phase 2 runs the bundled negative-test catalog and accepts human-authored plans against that catalog; adding new test types is Phase 3+ work." Runner-up: leave it implicit; rejected because the user explicitly asked "do any test on dev/sandbox" and the gap has to be closed in docs, not discovered at use time.

10. **Manifest mode (Mode B sub-mode B.1) is the default documented Mode B path.** When customers run Mode B, the documented happy-path is the manifest flow; step 06's auto-synthesize (Mode B sub-mode B.2) is power-user opt-in. CLI examples in step 11, docs in step 16, and any README references in step 13's fixture lead with manifest mode. (Mode A — `read_only_evidence` — remains the global default per `PHASE_2_PLAN`; this decision only orders the documentation within Mode B.) Reason: B.1 requires no admin/service-role credentials; B.2 does, and that's a much bigger trust ask we don't want as the default story. Runner-up: B.2 first; rejected because of the credential surface.

## What lands

- `phases/phase-2/decisions.md` records: every blocking decision (1–10, including the four preventer decisions above) with chosen option, runner-up, and tradeoff. This is the canonical record future Claudes / phase-planner runs consult.
- `package.json` pins for the AI SDK (Anthropic + later OpenAI), `zod` (peer of Anthropic SDK), `@supabase/supabase-js` (Admin SDK), and the signing-tool dep once decision 5 lands.
- One-line update in `CLAUDE.md` removing any Phase 2 "currently undecided" entries that get resolved here.

## Done when

Every blocking decision in the planner's Phase 2 report (including decisions 7–10) has a recorded pick + runner-up + tradeoff in `phases/phase-2/decisions.md`. `pnpm install && pnpm typecheck` is green with the new deps.

## Guardrails

- Do not silently pick a different option. If the user overrides a recommendation, record it.
- Do not install AI SDKs without their peer dependencies (`zod` for Anthropic SDK).
- Do not introduce the signing tool dep before decision 5 is settled.
- Do not commit any AI API key, even an "expired test key." Service-role and AI keys are accepted via env-var only.
- **Decisions 7–10 are downstream-step contracts.** Any future Phase 2 step file whose Done-when would violate them (mock-only verification, fixture-only gate, custom-test-type surface, B.2-as-default docs) must update its Done-when to comply, not route around it. If a step truly cannot comply, it must surface that as a planner-level decision rather than land code that quietly bypasses the contract.

## References

- `PHASE_2_PLAN.md` §6.1 (Required deliverables), §10.6 (model choice), §11.1 (approval flow)
- `FINAL_PRODUCT_PLAN.md` §17 (Phase 2 roadmap)
- Planner blocking-decisions section (2026-05-24)
