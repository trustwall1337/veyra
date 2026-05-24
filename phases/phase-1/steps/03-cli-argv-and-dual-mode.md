# Step 03 — CLI argv parsing and dual-mode scan entry

**Status:** done (2026-05-24)
**Maps to:** `PHASE_1_PLAN §7 Task 3`, §2 operating modes A and B, §6 `--fail-on-blocker`
**Produces:** `src/cli/index.ts` (replaces stub) + `src/cli/scan-command.ts`
**Depends on:** 02
**Executed by:** plain coding pass
**Verification:** Vitest unit tests on argv permutations, mode/env validation, exit-code behavior

## Goal

Wire the canonical `veyra scan` command using `commander`. Validates inputs, computes the `ValidationPolicy` from `--mode` + `--env`, instantiates the orchestrator from step 02. Phase 1's implementation surface is a scan runner + report generator — the CLI is the first delivery mechanism, not Veyra's product identity.

## What lands

- Replace the current `src/cli/index.ts` stub.
- `src/cli/scan-command.ts` implements the `scan` subcommand with these flags:
  - `--project <path>` (required) — path to the Lovable project root
  - `--supabase-schema <path>` — path to schema SQL (optional)
  - `--out <path>` — Markdown report output path (default `veyra-report.md`)
  - `--json <path>` — JSON report output path (optional)
  - `--fail-on-blocker` — exit non-zero when computed `readiness_status == launch_blocker` (semantics defined in step 14)
  - `--mode <mode>` (default `read_only_evidence`) — one of `read_only_evidence | sandbox_active_validation | approved_production_safe`. Phase 1 implements only the first. `sandbox_active_validation` lands in Phase 2 (`phases/phase-2/PHASE_2_PLAN.md`); `approved_production_safe` is a later-phase capability (`FPP §17 Phase 5`). Both reject at parse time with "not yet implemented."
  - `--env <type>` (default `local`) — one of `local | dev | preview | staging | sandbox | production`
  - `--lovable-mcp` — enable Lovable MCP connector path (requires `--lovable-project`)
  - `--lovable-project <id>` — required when `--lovable-mcp` is set. Needed because `get_project` requires an id and `list_projects` is denied by the allowlist
  - `--supabase-mcp <project_ref>` — enable Supabase MCP connector with project ref
  - `--no-ai` — disable AI provider entirely (Phase 1 default)
  - `--ai-provider <name>` — adapter selection stub (no provider wired in Phase 1)
- Path validation: `--project` must exist and be a directory; `--supabase-schema` must exist and be a file if passed.
- Mode / env validation:
  - `--mode read_only_evidence` accepted in any environment.
  - `--mode sandbox_active_validation` requires `--env` in `{ local, dev, preview, staging, sandbox }`; rejects on `production`. Currently rejects entirely with "Phase 2 — not yet implemented (see `phases/phase-2/PHASE_2_PLAN.md`)."
  - `--mode approved_production_safe` requires `--env production` AND an approval record (later-phase capability). Currently rejects with "not yet implemented (later phase; see `FPP §17 Phase 5`)."
- Builds the `ValidationPolicy` once from parsed flags via `defaultReadOnlyEvidencePolicy(env)`; passes it to the orchestrator.
- Wires CLI to `ScanOrchestrator` from step 02.
- Exit code logic: 0 on clean run, non-zero when `--fail-on-blocker` AND `readiness_status == launch_blocker`.

## Done when

`pnpm dev -- scan --project ./examples/vulnerable-lovable-supabase --supabase-schema ./examples/vulnerable-lovable-supabase/supabase/schema.sql --out r.md` parses, validates paths, builds a `read_only_evidence` policy, calls the orchestrator (still no-op), exits 0.

Unit tests cover:
- Missing `--project` → error
- Invalid path → error
- `--mode sandbox_active_validation` → rejected with explicit "Phase 2 — not yet implemented" message
- `--mode approved_production_safe` → rejected with explicit "not yet implemented (later phase; see `FPP §17 Phase 5`)" message
- `--lovable-mcp` without `--lovable-project` → rejected at parse with clear message
- `--mode read_only_evidence --env production` → accepted (read-only is safe in any env)
- `--fail-on-blocker` exit code behavior on both paths

## Guardrails

- No CLI string says "secure," "safe," or "compliant." Banner / help text uses §9 allowed-claims vocabulary only.
- No `--auto-fix`, `--remediate`, or `--scan-production` flag — §6 / §18 non-goals.
- `--ai-provider` accepts a string but does not import any provider SDK. AI is plumbing-only in Phase 1.
- Help text mentions: (a) MCP modes are optional, (b) Lovable PAT auth is not supported (per §1 verified capabilities), (c) only `read_only_evidence` mode is currently implemented.
- Deferred-mode rejections must include a clear "not yet implemented" message and exit non-zero — never silently fall back to a different mode. Each rejection points the user at the right plan doc (`phases/phase-2/PHASE_2_PLAN.md` for sandbox; `FPP §17 Phase 5` for production-safe).
- `--mode` rejection happens at parse time, BEFORE any agent runs, BEFORE any MCP connection.

## References

- `PHASE_1_PLAN.md` §2 (operating modes), §7 Task 3, §6 Required
- `CLAUDE.md` §Commands (script names), §MCP discipline
- existing: `src/cli/index.ts` (stub)
- Step 02 `ValidationPolicy` type and `defaultReadOnlyEvidencePolicy` factory
