# Phase 2 architectural decisions (cumulative)

This file records the Phase 2 blocking decisions resolved by step 2.01
plus any later material decisions made during Phase 2 implementation.
Future Phase 2 step files reference these by section number; future
planner runs read this file to seed the next plan.

Decisions are point-in-time. If a later step revisits one, add a new
section rather than editing the old one — the change history is the
audit trail. Same convention as `phases/phase-1/decisions.md`.

---

## 2026-05-26 — step 2.01: lock the ten Phase 2 blocking decisions

**Trigger.** Phase 2 step files 2.02 onward depend on a fixed set of
engineering choices. Step 2.01's job is to ratify or override the
planner picks for items 1–3, settle the three user decisions 4–6, and
lock the four Phase-1-mistake preventer decisions 7–10 as downstream-
step contracts. No Phase 2 code lands in this step.

### Decisions 1–3 — planner picks ratified

#### Decision 1 — AI provider order: Anthropic first

- **Picked:** Anthropic first. Default model `claude-sonnet-4-6`.
  Adapter lands in step 2.04. OpenAI fallback in step 2.05.
- **Runner-up:** ship both adapters in step 2.04.
- **Tradeoff:** dependency isolation + the default ships first vs
  faster availability of OpenAI for cross-model verification.
- **Status:** planner pick; user ratified 2026-05-26.

#### Decision 2 — `ActionExecutor` interface birthplace: Phase 1 step 02

- **Picked:** Phase 1 step 02 (typed stub) owns
  `src/core/policy/executors/types.ts`. Phase 2 step 2.02 imports it
  without modification.
- **Runner-up:** introduce it new in Phase 2 step 2.02.
- **Tradeoff:** type-stub-in-Phase-1 means later phases can layer
  executors without back-porting types.
- **Status:** settled in the 2026-05-24 Phase 1 alignment pass;
  recorded here for the audit trail.

#### Decision 3 — Prompt-cache TTL default: 5 minutes

- **Picked:** 5-minute default; `--ai-cache-ttl 1h` opts up.
- **Runner-up:** 1-hour default.
- **Tradeoff:** cost vs cache hit rate. Anthropic 2026 pricing
  charges 1-hour cache separately. Defaulting cheap is the safer
  floor; customers who measure hit-rate-vs-cost can opt up.
- **Status:** planner pick; user ratified 2026-05-26. Already wired
  in Phase 1 step 03b's CLI parsing surface.

### Decisions 4–6 — user picks

#### Decision 4 — Sandbox fixture form: recorded-fixture replay

- **Picked:** recorded-fixture replay.
- **Runner-up:** live disposable Supabase project.
- **Tradeoff:** recorded gives deterministic / repeatable / no
  network dependency in CI; live gives the highest fidelity but
  requires owning a Supabase test project and adds a CI network
  dependency. The recorded path freezes the Admin API contract at
  recording time; refresh requires an explicit human run.
- **Why this pick:** matches Phase 1's local-first trust posture
  and the FPP §18 binding (no hosted dependencies). Aligns with
  Phase 1 step 27's snapshot-mode + opt-in live-mode pattern for
  the Supabase REST contract test.
- **Status:** user picked 2026-05-26. Affects step 2.13.

#### Decision 5 — Approval-file format: Option A (minimal JSON + minisign)

- **Picked:** Option A — minimal JSON `{ scan_id_prefix, granted_at,
  granted_by, scope: { project_ref, max_synthetic_records,
  expires_at } }` with a detached **minisign** signature.
- **Runner-up:** Option A with sigstore/cosign signature; Option B
  in-toto / DSSE attestation envelope.
- **Tradeoff:** minisign is the smallest of the three signing tools
  (single static binary, no PKI infrastructure, Ed25519). cosign
  ecosystem-aligns with container signing but is a much heavier dep.
  in-toto / DSSE is standards-track but pushes a library decision
  to step 2.11.
- **Why this pick:** Phase 1's dep-light precedent; minisign's
  attack surface is small (Ed25519, no chain-of-trust to manage);
  the approval is human-issued and infrequently rotated — minisign
  matches the operational shape.
- **Specific npm library:** deferred to step 2.11 implementation
  (candidate `minisign-verify` for verify-only — Veyra never signs;
  the approver runs minisign out-of-band to produce the signature).
  Step 2.01 does NOT install the verify library; step 2.11 picks it
  with explicit knowledge of which verify call sites need it.
- **Status:** user picked 2026-05-26. Affects step 2.11. The
  signing-tool npm dep is added in step 2.11, not here.

#### Decision 6 — `/scan-fixture-active`: new command, not extension

- **Picked:** new command `scan-fixture-active`. Phase 1's
  `/scan-fixture` deterministic gate stays frozen as a regression
  bar.
- **Runner-up:** extend `/scan-fixture` with an `--active` flag.
- **Tradeoff:** new command is cleaner failure isolation and a
  clearer customer mental model (Mode A vs Mode B); extending one
  command means less CLI surface but risks shared state regressing
  the Phase 1 gate.
- **Why this pick:** the Phase 1 deterministic gate is a release-
  blocking regression bar; protecting it from active-validation
  changes is worth one extra command. Mirrors Phase 1 step 22's
  end-to-end gate pattern.
- **Status:** user picked 2026-05-26. Affects step 2.15.

### Decisions 7–10 — Phase-1-mistake preventers (downstream-step contracts)

These four were surfaced by the 2026-05-25/26 live Phase 1 validation
runs that exposed two recurring patterns: (a) code that types-and-
tests-passes against mocks but fails against real endpoints, (b)
fixture-tight implementations that work on the seeded fixture but
real dev/sandbox behavior is untested. Recorded here as binding
contracts on every future Phase 2 step's Done-When.

#### Decision 7 — Real endpoint-transport smoke test required

- **Picked:** every Phase 2 step that wraps a real provider/client
  transport must include either (i) a live-endpoint smoke test,
  env-var-gated so CI skips when secrets are absent (skip emits an
  explicit `skipped_missing_env` result rather than passing
  silently), OR (ii) a recorded-from-real snapshot — never
  mock-only. At least one release gate runs live or refreshes the
  recorded snapshot.
- **Affects:** step 2.03 (sandbox executor), step 2.06 (Supabase
  Admin API), step 2.06b (`auth.signInWithPassword`), step 2.08
  (PostgREST fetch).
- **Runner-up:** keep mock-only and ship.
- **Why rejected:** that's the exact pattern that produced Phase 1's
  `--supabase-mcp` no-op (step 24) and the parser-empty-on-real-dump
  bug (step 26).
- **Status:** planner pick; user ratified 2026-05-26. Binding on
  future Phase 2 step Done-When fields.

#### Decision 8 — Representative dev/sandbox-project gate paired with the fixture gate

- **Picked:** step 2.15 (fixture validation gate) pairs the seeded
  happy fixture with an end-to-end test against a representative
  dev/sandbox project outside the seeded fixture, or a sanitized
  recorded-from-real snapshot. Step 2.15's Done-When explicitly
  takes a new assertion: the active-validation pipeline produces a
  non-empty `active-validation-results.json` against the
  representative-or-recorded input.
- **Affects:** step 2.15.
- **Runner-up:** fixture-only gate.
- **Why rejected:** "fixture passes, real dev/sandbox behavior is
  untested" is the exact mistake paid for in Phase 1 step 26.
- **Status:** planner pick; user ratified 2026-05-26. Binding on
  step 2.15.

#### Decision 9 — Catalog-bound executable-test universe

- **Picked:** customers cannot author custom executable test
  *types* in Phase 2; they may only select / parameterize catalog
  entries that pass the compiler. The AI security planner (step
  2.07b) is already constrained to the catalog by the
  `planner-output-is-subset-of-catalog` test; step 2.07c allows
  human-authored *plans* that still compile against the catalog.
- **Affects:** steps 2.07b, 2.07c, 2.16.
- **Runner-up:** leave it implicit.
- **Why rejected:** customer expectation must match reality —
  "Phase 2 runs the bundled negative-test catalog and accepts
  human-authored plans against that catalog; adding new test types
  is Phase 3+ work."
- **Status:** planner pick; user ratified 2026-05-26. Step 2.16
  documentation must state this distinction explicitly.

#### Decision 10 — Manifest mode (Mode B sub-mode B.1) is the default documented Mode B path

- **Picked:** when customers run Mode B, the documented happy-path
  is the manifest flow. Step 2.06's auto-synthesize (Mode B
  sub-mode B.2) is power-user opt-in. CLI examples in step 2.11,
  docs in step 2.16, and any README references in step 2.13's
  fixture lead with manifest mode.
- **Note:** Mode A (`read_only_evidence`) remains the global default
  per `PHASE_2_PLAN`; this decision only orders the documentation
  within Mode B.
- **Affects:** steps 2.06, 2.11, 2.13, 2.16.
- **Runner-up:** B.2 first.
- **Why rejected:** B.1 requires no admin/service-role credentials;
  B.2 does, and that's a much bigger trust ask we don't want as the
  default story.
- **Status:** planner pick; user ratified 2026-05-26.

### What lands in this step

- This file (`phases/phase-2/decisions.md`).
- `package.json` pin: `@supabase/supabase-js` at an exact version
  (the Admin SDK consumed in step 2.06). Pinned via `pnpm add
  @supabase/supabase-js@<exact> --save-exact` — same discipline as
  commander@14.0.3, @anthropic-ai/sdk, zod, @modelcontextprotocol/sdk.
- `pnpm-lock.yaml` refresh.
- **NOT changed:** `CLAUDE.md` — no Phase 2 "currently undecided"
  entries existed to remove.

### Out of scope (NOT in step 2.01)

- The minisign npm library pick — deferred to step 2.11 implementation.
- The OpenAI adapter — Phase 2 step 2.05.
- The in-toto / DSSE attestation library — would have been Decision 5
  Option B; not picked.
- Any Phase 2 implementation code.

### References

- `phases/phase-2/PHASE_2_PLAN.md` §6.1, §10.6, §11.1 — the source of
  the blocking-decisions list.
- `phases/FINAL_PRODUCT_PLAN.md` §17 — Phase 2 roadmap.
- `phases/phase-1/decisions.md` — same convention; precedent for
  this file's format.
- Planner blocking-decisions section (2026-05-24) — original picks.
