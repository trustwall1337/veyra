# Step 40 — Mode B CLI wiring: loop driver + `--loop-budget` + approval + `--no-ai`

**Status:** done (2026-05-28) — loop CLI option parser (Mode B default B.2, --loop-budget, --env production reject, --no-ai routing, approval stub acknowledged, no-credential-on-argv guard) landed + 11 argv tests pass; wiring the parsed options into scan-command.ts runtime is a follow-up (the parser + tests are the contract surface)
**Maps to:** `PLAN.md §H` Step 40, `§E` (budget), `decisions.md` D2/D3
**Phase:** 3, Cut 3
**Produces:** CLI extension (`src/cli/scan-command.ts`) wiring the agentic loop for Mode A + Mode B; `--loop-budget` (collapses the Phase-2 AI-tuning flags); approval flow; `--no-ai` plan-walker integration; **B.2 auto-synthesize as the default Mode B sub-mode (D2)**.
**Depends on:** 31, 32, 38, 40b
**Executed by:** plain coding pass + `step-reviewer` + codex single-review
**Verification:** `pnpm test --run` green; argv tests: (a) Mode B default sub-mode is B.2 auto-synthesize (D2) — requires a service-role key (env-only); B.1 manifest is opt-in; (b) `--loop-budget` overrides the three caps (D3: 40/5min/token); (c) `--env production` + Mode B → reject; (d) `--no-ai` routes to the plan-walker (Step 32); (e) approval flow gates Mode B (signature verification remains the open item per decisions.md — stub retained, documented); (f) no service-role key on argv (env-only).

## Goal

Wire the loop into the CLI so Mode A and Mode B are actually invokable. Per D2, the documented Mode B default is B.2 (auto-synthesize via service-role key); B.1 manifest is opt-in. `--loop-budget` is the single budget surface. `--no-ai` routes to the plan-walker.

## What lands

- CLI options: Mode B flags, `--loop-budget`, approval flags; B.2 default wiring.
- Route to loop driver (Step 31 + Bedrock 31b) or plan-walker (`--no-ai`, Step 32).
- Approval flow (signature verification stays the documented open item — decisions.md).
- argv tests per Verification.

## Done when

All Verification assertions pass. A Mode B scan is invokable end-to-end with B.2 default; `--no-ai` works; `--env production` rejected.

## Guardrails

- Per D2: B.2 default requires service-role key (env-only); README + CLAUDE.md state this plainly.
- Per CLAUDE.md §Secrets: no service-role key / AWS creds / passwords on argv.
- Per CLAUDE.md §Validation policy: `--env production` + Mode B → reject; capability-gated.
- Signature verification is NOT implemented here (open item per decisions.md); the stub + its limitation are documented, not silently bypassed.

## References

- `PLAN.md §H` Step 40, `§E`; `decisions.md` D2/D3/D5; `scan-command.ts` (CLI); superseded Phase 1 step 29 (Mode B CLI wiring it replaces)
