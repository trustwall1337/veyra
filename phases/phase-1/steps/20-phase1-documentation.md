# Step 20 — Phase 1 documentation

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 1` (docs/), §6 Required (documentation for safe metadata export); `FINAL_PRODUCT_PLAN §8` trust documentation
**Produces:** `docs/phase-1.md`, `docs/lovable-mcp-safety.md`, `docs/supabase-metadata-export.md`, `docs/data-access-and-trust.md`
**Depends on:** 03, 15, 16, 19
**Executed by:** plain coding pass (+ `output-language-lint` subagent)
**Verification:** `output-language-lint` clean across `docs/`

## Goal

Ship the user-facing documentation Phase 1 promises. Reflects actual CLI flags, actual connector behavior, actual report shape. Last step because docs reference everything else.

## What lands

- `docs/phase-1.md` — overview, what Phase 1 does and does not do, how to run a scan, how to read the report.
- `docs/lovable-mcp-safety.md` — what the Lovable connector calls, what it doesn't, why the six-tool allowlist exists, how new Lovable tools are auto-denied. Cite `PHASE_1_PLAN §3 Step 1`.
- `docs/supabase-metadata-export.md` — what metadata the Supabase connector reads, why `read_only=true` is mandatory, why `execute_sql` is denied even though it works under read-only. Walks the user through exporting `schema.sql` safely if they prefer not to use MCP.
- `docs/data-access-and-trust.md` — the trust model in plain language: Veyra reads, never writes; reports are evidence-shaped, never definitive; AI output (when present) is labelled with confidence and uncertainty; the user is responsible for the final security decision. Per `FINAL_PRODUCT_PLAN §8`.

## Done when

- Four docs exist and reference real CLI flags, real connector tool names, real report sections.
- `output-language-lint` subagent clean across all four files.
- Each doc names the `PHASE_1_PLAN` / `FINAL_PRODUCT_PLAN` section it derives from.
- README is updated to link to `docs/phase-1.md` as the entry point.

## Guardrails

- Use only §9 allowed-claims vocabulary. No "secure," "safe," "compliant" anywhere — including marketing-sounding hero text.
- Be explicit about non-goals: docs name the §6 / §18 lists. The user should not be surprised that Veyra doesn't do Slack, dashboards, auto-fix, compliance reports, or production scanning.
- Be explicit about limits: heuristic agents produce `likely_issue`, not `confirmed_issue`. The regex schema parser may miss complex SQL. The Lovable PAT is not supported. Static authn detection misses SSR / middleware checks.
- Do not document any feature that hasn't shipped. If step 15 didn't land Lovable MCP, `lovable-mcp-safety.md` either doesn't ship or says "not yet implemented."

## References

- `PHASE_1_PLAN.md` §6 (Required), §7 Task 1, §9 (non-claims)
- `FINAL_PRODUCT_PLAN.md` §8 (trust documentation), §18 (non-goals)
- All step files in this directory for the actual delivered surface
