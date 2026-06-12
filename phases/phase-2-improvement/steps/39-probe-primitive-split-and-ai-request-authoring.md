# Step 39 — Probe-primitive split: AI-authored request shapes within `requestSchema`

**Status:** done (2026-05-28) — probe-primitive substrate (RequestSchema with aiAuthored/fixed markers), compiler (rejects fixed-override, off-schema params, body-injection), outcome classifier (deterministic, joins the floor), and a sample IDOR probe + tests landed; full 13-entry catalog migration is deferred (canonical pattern + sample shipped)
**Maps to:** `PLAN.md §C` (probe primitives), Directive 1 (AI authors method/URL/body), carries PLAN-v1 §D.F
**Phase:** 3, Cut 3
**Produces:** the 13 sandbox-runner catalog entries split into (i) a `probe-http` tool whose `requestSchema` declares which fields AI may author vs which are fixed, and (ii) a deterministic outcome-classifier predicate (joins the floor). All writes via Step 38's `executeWriteWithRegistry()`.
**Depends on:** 38, 35
**Executed by:** plain coding pass + `mcp-policy-check` + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; tests assert: (a) each catalog entry declares a `requestSchema {method, urlTemplate, bodySchema}` with `aiAuthored`/`fixed` field markers; (b) AI may parameterize `aiAuthored` fields, cannot author `fixed` fields; (c) the compiler validates AI's proposed request against the entry's schema before execution (Zod), reject → `arg_reject`/`tool_result_reject`; (d) URL path segments AI authored match the schema regex bound; (e) every write goes through Step 38's wrapper; (f) the outcome-classifier (e.g. `rowsLeak` for cc-11-3) stays deterministic and joins the floor — it is NOT in-loop.

## Goal

Directive 1: AI authors HTTP method/URL/body for active probes — but bounded by a per-primitive `requestSchema` and executed through the cleanup-aware registry. The 13 catalog entries' assertion logic is preserved (becomes deterministic floor classifiers); their previously-fixed request shape becomes AI-authored-within-schema. The TEST TYPE stays catalog-bound (preventer 9 spirit); the PARAMETERS (and now request shape, within schema) are AI-authored.

## What lands

- Per-primitive `requestSchema` for each of the 13 entries (method/urlTemplate/bodySchema + aiAuthored/fixed markers).
- `probe-http` tool: AI authors within schema; compiler validates; writes via Step 38.
- Outcome-classifiers relocated to the floor (deterministic, per Step 35's pattern).
- Tests per Verification.

## Done when

All Verification assertions pass. An IDOR probe (cc-11-3) runs with an AI-authored target row id within schema bounds, the write (if any) is registry-tracked, and the outcome classifier (deterministic) produces `proven_allowed`/`proven_denial`/`inconclusive`.

## Guardrails

- Per preventer 9 (amended): AI authors parameters + request shape WITHIN `requestSchema`; AI does NOT invent new executable test types.
- Per D1/Step 38: every write through `executeWriteWithRegistry()`; no direct mutating call.
- Per CLAUDE.md §Output language: outcome wording uses allowed claims only.
- Body Zod schema rejects anything outside the declared shape (injection/pollution guard); per-field length caps.

## References

- `PLAN.md §C`; PLAN-v1 §D.F; `sandbox-runner/agent.ts`, `test-catalog/*`
