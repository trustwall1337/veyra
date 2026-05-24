# Step 10 — Authn agent

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 10`, §4.2
**Produces:** `src/agents/authn/`
**Depends on:** 02, 04, 08
**Executed by:** `/new-agent` skill (+ `write-finding` skill)
**Verification:** integration test against fixture's seeded vulnerable routes; `output-language-lint` clean

## Goal

Determine whether authentication appears to be required and enforced for sensitive routes/actions. Two Phase 1 heuristics: frontend-only protected route, admin route without obvious server-side role check. Reads Semgrep findings from the artifact store (from step 08) and the project's route files.

## What lands

- `src/agents/authn/agent.ts` — implements `VeyraAgent<AuthnInput, AuthnOutput>`.
- `src/agents/authn/heuristics.ts` — two heuristics:
  1. Route component contains client-side `if (!user) redirect(...)` pattern but no server-side check anywhere in the codebase → `likely_issue`
  2. Route or handler name matches `admin*` / `/admin/*` / `requireAdmin` but no role-check function/decorator detected → `likely_issue`
- Reads `scanner-findings.json` (from step 08) to use Semgrep route-pattern matches as evidence references.
- Test fixtures in `src/agents/authn/__fixtures__/` to test heuristics in isolation.

## Done when

- `/new-agent` skill checklist all green.
- Fixture's frontend-only-protected route and admin-route-without-server-check each produce the expected `likely_issue` finding with non-empty `evidence_refs` pointing at the Semgrep finding.
- If `scanner-findings.json` is missing (tool-runner failed upstream), agent emits `coverage_gap` for both controls, does not crash.
- `output-language-lint` clean.

## Guardrails

- Per §4.2: "If server-side evidence is missing, classify as `missing_evidence` or `likely_issue`, not confirmed." No `confirmed_issue` findings from this agent.
- Agent never contacts a real auth provider. Static evidence only in Phase 1.
- No `import` line points at any other agent. Reads upstream output via artifact store only (§4.0).
- `uncertainty_notes` should explain the limits of static authn detection (e.g. "server-side checks via SSR/middleware may exist but not be detected by static pass").

## References

- `PHASE_1_PLAN.md` §4.2 (Authn controls), §7 Task 10
- `FINAL_PRODUCT_PLAN.md` §11 (checks 1, 2)
- `.claude/skills/new-agent/SKILL.md`, `.claude/skills/write-finding/SKILL.md`
- Step 04 fixture routes, step 08 tool-runner artifact
