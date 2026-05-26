# Phase 1 architectural decisions (cumulative)

This file records material architectural decisions made during Phase 1
implementation that are not already captured in `PHASE_1_PLAN.md` or
`FINAL_PRODUCT_PLAN.md`. Each section gives the date, the trigger, the
decision, the alternative(s) considered, and the rationale.

Decisions are point-in-time. If a later step revisits one of these,
add a new section rather than editing the old one — the change history
is the audit trail.

---

## 2026-05-26 — step 27: REST is the customer-default Supabase backend

**Trigger.** Live UX testing 2026-05-25/26 against a real Supabase
project surfaced six wrong assumptions baked into steps 16, 24, 25, 26.
The original Phase 1 plan committed to Supabase MCP as the live
schema-read path. In practice MCP required spawning
`npx @supabase/mcp-server-supabase@latest` as a subprocess and the
official MCP Inspector strips env vars and drops
`SUPABASE_ACCESS_TOKEN`, masking auth failures as protocol failures.
The Supabase Management REST API exposes the same documented metadata
via plain HTTPS with a Bearer token — no subprocess, no env-propagation
hazard, no MCP protocol overhead.

### The six wrong assumptions and the chosen direction

**A — "MCP is the right transport for fetching Supabase database metadata."**
- Decision: Demote MCP to alternative backend. REST is the customer
  default for `database/openapi`, `storage/buckets`, `config/storage`.
- Alternative considered: keep MCP as primary and document workarounds
  for the MCP Inspector env-var-drop issue.
- Rationale: REST removes the subprocess, the npx install, and the
  env-propagation failure mode in one move. MCP stays as a registered
  alternative for the policy-bodies surface that REST does not expose.
- NOT in scope: PostgREST query-surface checks (cc-11-13a..e) — those
  remain Phase 2 work and may legitimately use a different backend.

**B — "Lovable MCP works the same as Supabase MCP."**
- Decision: Parse-time reject `--lovable-mcp` with the step-28-deferred
  message. Lovable's MCP server uses OAuth from inside the calling MCP
  client only; there is no static personal-access-token equivalent.
- Alternative considered: implement a partial OAuth flow now.
- Rationale: Veyra has no OAuth client in Phase 1, and a partial flow
  would ship a flag that confuses customers more than it helps. The
  honest "we don't have this yet" message is preferable to a flag that
  pretends to work.

**C — "Local CLI with a long prerequisite list is acceptable."**
- Decision: Drop `supabase` CLI and the `npx`-spawned MCP server from
  the customer-facing prerequisite list. Document the irreducible
  local-first floor (Node 22 + pnpm + gitleaks + osv-scanner).
- Alternative considered: replace gitleaks / osv-scanner with HTTP-API
  equivalents.
- Rationale: Uploading code or dependency data to remote scanners would
  break the local-first trust posture that FPP §18 makes binding.
  Follow-up: a Phase 2+ "bundle/cache managed binaries" task may
  reduce install friction without breaking the trust property.

**D — "Fixture/dev flags are acceptable customer flows when the customer flow is broken."**
- Decision: Customer flags vs developer flags are documented separately.
  Developer flags use the `--dev-*` prefix AND require `VEYRA_DEV=1` to
  be set in the environment. Help text hides `--dev-*` flags by default.
- Alternative considered: a single `--dev` super-flag that gates
  everything experimental.
- Rationale: Double-gating (prefix + env var) means a single accidental
  copy-paste from a contributor's terminal doesn't activate dev flags
  in customer use. A super-flag is one mistake away from activation.

**E — "Local clone is acceptable customer automation for Lovable."**
- Decision: Phase 1 Lovable code read is `local-git-clone` only. This
  step does NOT solve the manual-clone gap; it explicitly acknowledges
  it as a remaining Phase 1 limitation in `docs/lovable.md` and the
  README.
- Alternative considered: defer the Lovable code source until the OAuth
  client lands.
- Rationale: A documented limitation is better than a broken automation.
  Step 28 (if pursued) addresses Lovable-driven file fetch; until then,
  the customer clones their Lovable GitHub repo and passes `--project`.

**F — "Artifact and source names should be transport-shaped."**
- Decision: Normalise around capability discriminators —
  `database-metadata.json`, `storage-metadata.json`, `code-evidence.json`.
  Existing transport-shaped names (`supabase-mcp`, `supabase-schema`,
  `supabase-tables`) stay as one-release compatibility aliases; the
  next step removes the aliases.
- Alternative considered: keep transport-shaped names and add a parallel
  capability-shaped set.
- Rationale: A second backend appearing immediately breaks transport-
  shaped names; capability shapes scale to N backends. The aliases keep
  one release of grace so downstream tooling can migrate without a hard
  break.

### What lands in this step

- `src/types/data-sources.ts` — capability interfaces.
- `src/data-sources/{supabase-rest,supabase-mcp,local-sql-file,lovable-github-clone}/`
  — registry-resolved backends.
- CLI: `--supabase <project_ref>` (customer); `--dev-supabase-backend
  <id>` and `--dev-supabase-schema <path>` behind `VEYRA_DEV=1`;
  `--supabase-mcp` and `--lovable-mcp` reject at parse-time.
- CLAUDE.md §MCP discipline amendment (storage-from-MCP-only →
  `StorageMetadataSource` REST-or-MCP under policy gate).
- Snapshot-mode contract test for the three v1 REST endpoints; live
  mode opt-in via `VEYRA_LIVE_TESTS=1`.

### What does NOT land

- Lovable OAuth client (step 28 if pursued).
- Replacement of gitleaks/osv-scanner with HTTP equivalents (rejected
  for trust reasons).
- A hosted product surface (FPP §18 stays binding).
- Phase 2 PostgREST query-surface checks (cc-11-13a..e).
- Removal of the existing MCP code path. It stays as an alternative
  backend.

### How to verify

Snapshot mode runs in CI as part of `pnpm test`. Live mode is opt-in
via `VEYRA_LIVE_TESTS=1 + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF`.
The customer-facing scan command is:

```
export SUPABASE_ACCESS_TOKEN=<your-token>
pnpm dev -- scan --project <empty-dir> --supabase <project_ref> --out report.md
```

A live scan against a real Supabase sandbox project should:

- exit 0 (or non-zero with `--fail-on-blocker` when findings warrant)
- produce real findings on schema-driven controls OR a per-capability
  `coverage_gap` with the REST error-derived reason
- show no `npx` / `node` children spawned by Veyra for Supabase work
- continue to scan when `supabase` is removed from `PATH`

### References

- `phases/phase-1/steps/27-architectural-course-correction-rest-and-honest-paths.md`
  — the full step file with Done-When + Guardrails.
- `CLAUDE.md §MCP discipline` — amended in this step.
- `CLAUDE.md §Validation policy` — `allowed_actions`-based gating is the
  model the REST backend enforces.
- `FPP §2A` — extensibility-first principle this step is faithful to.

---

## 2026-05-26 — step 28a: extract local-clone CodeSource; defer OAuth to 28b

**Trigger.** Step 27 claimed `src/data-sources/lovable-github-clone/`
existed when it did not — the file-walk lived inline in
`src/agents/product-understanding/inventory/bootstrap.ts`. Step 28
proposed OAuth-backed Lovable MCP code reads on top of that
non-existent CodeSource. Splitting the work into 28a (refactor) and
28b (OAuth) keeps the refactor unblocked while the OAuth pieces wait
for the live-probe outcomes the step file says must be recorded
**before** any persisted code uses them.

### Decision

- **Split step 28 into 28a + 28b.**
- **28a (landed):** extract the inline file-walk into
  `src/data-sources/lovable-github-clone/code-source.ts` implementing
  the existing `CodeSource` interface; register through the
  data-source registry as `lovable-github-clone`; capability-gated on
  `read_code`; extend `DataSourceErrorKind` with `'plan_not_available'`
  for future tier-gated coverage_gap rendering (28b consumes); leave
  the `--lovable-mcp` parse-time-reject message exactly as step 27
  wrote it (still points at the local-clone fallback — 28b updates it
  once `--lovable` actually works).
- **28b (blocked on pre-coding probe):** OAuth 2.0 / PKCE client,
  `lovable-mcp` CodeSource, `--lovable <project_id>` CLI flag, live
  integration test. Requires the three pre-coding facts (endpoint URL,
  DCR vs Veyra-specific client id, scope behaviour) committed here
  before any persisted Veyra code starts using them.

### Why split

- Step 27's "non-existent file" gap is independently fixable and
  deserves a clean refactor without OAuth complexity.
- The OAuth client's behavior depends on Lovable's actual surface,
  not assumptions. The step file is explicit: PAUSED, not routed
  around if pre-coding probes fail. Doing 28b before the probe risks
  rework once Lovable confirms.
- The `DataSourceErrorKind` extension is small enough to land with
  28a; tier-gated coverage_gap rendering is a 28b concern but the
  type is shared.

### What 28a does NOT change

- The `--lovable-mcp` parse-time-reject message (still says "deferred
  to Phase 1 step 28" — points users at the local-clone fallback).
  28b updates it when `--lovable` is a working flag.
- The bootstrap composer's public API: `buildBootstrapInventory(...)`
  still returns the same shape, including the `readonly string[]`
  file_map. Internally it now calls the CodeSource module's
  `walkPaths` helper rather than an inline walk.
- The denylists (`DIR_DENYLIST`, `PATH_PREFIX_DENYLIST`,
  `isExcludedPath`) — same content, now canonically owned by the
  CodeSource module and re-exported from `bootstrap.ts` for
  back-compat with tests.

### References

- `phases/phase-1/steps/28-lovable-oauth-client-and-codesource.md`
  — the full step file with Pre-coding facts that need locking.
- `src/data-sources/lovable-github-clone/code-source.ts` — the new
  module 28a creates.
- `src/types/data-sources.ts` — `DataSourceErrorKind` gains
  `'plan_not_available'`.
