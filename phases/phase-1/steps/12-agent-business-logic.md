# Step 12 — Business-logic agent

**Status:** done (2026-05-25)
**Maps to:** `PHASE_1_PLAN §7 Task 12`, §4.5
**Produces:** `src/agents/business-logic/`
**Depends on:** 02, 17
**Executed by:** `/new-agent` skill (+ `write-finding` skill)
**Verification:** snapshot test against a known `declared-context.json`; assertion that no `confirmed_issue` is ever produced

## Goal

Generate review questions and suggested negative tests from the declared project context. Phase 1 keeps this **deterministic** — a fixed checklist applied to the declared context, not AI-generated questions. The deterministic version still satisfies §4.5; AI question generation can move in at Phase 1.5.

## What lands

- `src/agents/business-logic/agent.ts` — implements `VeyraAgent`.
- `src/agents/business-logic/checklist.ts` — fixed checklist of business-logic concerns, each parameterized by declared-context shape:
  - Self-approval workflows on money / role / ownership changes
  - Cross-tenant invitations or attachments
  - Server-side admin enforcement (vs frontend-only)
  - File / attachment access scoped to owner or tenant
  - Tenant-membership transitions (leave, invite, demote)
  - Refund / reversal / cancel flows authorization
- For each checklist item that applies to the declared context (e.g. project declares "money flows" or "multi-tenant"), emit a `coverage_gap` finding with `suggested_tests`.
- Test fixtures: known `declared-context.json` shapes → snapshot expected output.

## Done when

- `/new-agent` skill checklist all green.
- Snapshot test passes against a known `declared-context.json` fixture.
- Agent NEVER emits `confirmed_issue` (assertion-tested per §4.5).
- Each emitted finding has at least one `suggested_test` describing the missing negative test.
- `output-language-lint` clean.

## Guardrails

- Per §4.5: "Business-logic findings are never `confirmed_issue` unless backed by clear code/test evidence." In Phase 1 we don't have that evidence path, so the assertion is: zero `confirmed_issue`, always.
- No AI provider call in Phase 1. The checklist is a pure function from declared context to findings.
- Findings are `coverage_gap` (when negative tests are missing) or `missing_evidence` (when context lacks the needed declaration). No invented findings.
- Do not duplicate suggestions across runs — checklist must be deterministic and idempotent.

## References

- `PHASE_1_PLAN.md` §4.5 (Business-logic controls), §7 Task 12
- `FINAL_PRODUCT_PLAN.md` §11 (checks 9–12)
- `.claude/skills/new-agent/SKILL.md`, `.claude/skills/write-finding/SKILL.md`
- Step 17 produces the declared-context.json this agent consumes
