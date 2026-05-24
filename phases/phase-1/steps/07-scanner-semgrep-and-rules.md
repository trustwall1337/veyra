# Step 07 — Semgrep adapter + custom rules

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 9`, §1 Semgrep verified, §3 Step 3 deterministic checks
**Produces:** `src/scanners/semgrep/` + `rules/{authz,supabase,secrets}/*.yaml`
**Depends on:** 02, 04
**Executed by:** `/new-scanner-adapter` skill (adapter) + plain coding pass (rules)
**Verification:** `semgrep --test` against `rules/` fixtures + adapter unit tests with fixture JSON

## Goal

Wrap Semgrep behind an adapter and ship the first batch of custom rules. Phase 1 stays on YAML rules (deterministic, evidence-shaped). LLM-verified workflows are out of scope.

## What lands

- `src/scanners/semgrep/adapter.ts` — invokes `semgrep --config <ruleset> --json <project>` via `spawn`.
- `src/scanners/semgrep/parser.ts` — JSON parsing into normalized `ScannerFinding[]`.
- `src/scanners/semgrep/types.ts`, `src/scanners/semgrep/index.ts`.
- Adapter fixtures under `src/scanners/semgrep/__fixtures__/`.
- `rules/authz/` — rules for:
  - Direct object access by ID without user/tenant constraint
  - Query using client-provided `tenant_id`
  - Admin-route handler with no server-side role check
- `rules/supabase/` — rules for:
  - Client-side use of Supabase service-role key
  - Supabase client created with anon key but used for privileged operation
- `rules/secrets/` — supplementary rules for non-credential secrets Gitleaks doesn't catch (e.g. hardcoded webhook URLs).
- Each rule has positive (`should-match`) and negative (`should-not-match`) fixtures under `rules/<category>/tests/`.

## Done when

- `semgrep --test rules/` passes (positive fixtures match, negative fixtures don't).
- Adapter fixture tests cover: happy path, no findings, malformed JSON, binary missing.
- Every rule has a TSDoc-style top comment explaining intent and the §11 check it addresses.

## Guardrails

- Rules must not produce `confirmed_issue` blindly. Severity in the rule maps to `evidence_strength`; the agent that consumes Semgrep output (step 08 + step 10/11) decides classification.
- No LLM workflows, no Semgrep autofix in Phase 1 (per `FINAL_PRODUCT_PLAN §18` non-goals and trust model).
- Rules are versioned under `rules/` at repo root, not inside `src/scanners/semgrep/` — convention confirmed in `CLAUDE.md §Architecture`.
- Subprocess uses `spawn` with array args.

## References

- `PHASE_1_PLAN.md` §1 (Semgrep verified), §3 Step 3, §7 Task 9
- `CLAUDE.md` §Architecture (rules/ location)
- `.claude/skills/new-scanner-adapter/SKILL.md`
- Step 04 fixture
