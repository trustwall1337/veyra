---
description: Run a Phase 1 step end-to-end — reads the step file, plans the work, asks approval, implements, verifies, stops before commit.
argument-hint: <step-number, e.g. 1 or 01>
---

Run Phase 1 step `$ARGUMENTS`.

## 1. Find the step file

Pad `$ARGUMENTS` to two digits and find the matching file in `phases/phase-1/steps/NN-*.md`. If no file matches, stop and tell the user — do not guess a step number.

## 2. Read the contract

Read the step file. From it, note:

- `Maps to:` — also read the linked `phases/phase-1/PHASE_1_PLAN.md` §s.
- `Produces:` — files / artifacts the step must deliver.
- `Depends on:` — if earlier steps look undone, warn the user and stop.
- `Verification:` — the exact command that confirms success.
- `Done when:` — the success contract.
- `Guardrails:` — hard limits for this step.

Then re-read `CLAUDE.md §Hard rules`. They apply to every step.

## 3. Pick the helpers

Based on what the step touches, decide which project subagents / skills you will use:

- Changes under `src/connectors/{lovable,supabase}/` → `mcp-policy-check` subagent before finishing.
- User-facing strings (reporters, CLI text, README) → `output-language-lint` subagent + `/check-trust-model`.
- New agent under `src/agents/<name>/` → `/new-agent` skill.
- New connector → `/new-connector` skill.
- New scanner adapter → `/new-scanner-adapter` skill.
- Any non-trivial diff → `plan-adherence` subagent at the end (confirms the diff matches `Done when:` and didn't drift into a "Not Required" item).

If none apply, say so explicitly in the plan.

## 4. Plan

Enter plan mode. The plan must include:

1. The step's `Done when:` (verbatim).
2. The files this step will create or edit.
3. The subagents / skills to call, and why each one.
4. The exact `Verification:` command to run at the end.
5. Anything from `Guardrails:` that constrains the approach.

Use `ExitPlanMode` to hand the plan to the user. Wait for approval. Do not start work before approval.

## 5. Implement

Do the work as planned. If you discover the plan was wrong, **stop and re-plan** — never silently change scope.

Use the subagents and skills you listed in the plan. Do not invent new helpers mid-flight.

## 6. Verify

Run the step's `Verification:` command. If it fails:

- Report the failure and stop.
- Do not auto-fix unless the fix is obviously inside the step's scope.

## 7. Update the step file's Status header

Once verification passes, edit the step file itself: change the `**Status:** not started` line at the top to `**Status:** done (YYYY-MM-DD)`. Use today's date. If a commit hash is available (the user has already committed), append it: `**Status:** done (YYYY-MM-DD, commit <short-sha>)`. This keeps each step file truthful about its own state — future sessions read the Status header to know where to pick up.

## 8. Stop. Do not commit.

Show `git status` and `git diff --stat`. The user commits, not you. The diff is the deliverable.

## Hard rules (apply to every step, every time)

- Output language: only "checked," "found," "missing," "appears launch-blocking," "needs human review," "negative tests should be added." Never "secure," "safe," or "compliant."
- Heuristic findings → `likely_issue`, never `confirmed_issue`.
- Gitleaks always with `--redact`. No raw secret values in artifacts, logs, or reports.
- Lovable MCP allowlist (Phase 1): `get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` (`plan_mode` + fixed templates only). Everything else forbidden.
- Supabase MCP: every call needs `read_only=true` AND `project_ref`. No `execute_sql`, no mutations, no user-row queries.
- The "Not Required" lists in `PHASE_1_PLAN.md §6` and `FINAL_PRODUCT_PLAN.md §18` are binding — stop and ask before adding hosted dashboards, Slack, PR comments, autonomous remediation, or compliance claims.

## What you must never do

- Pick subagents / skills that don't exist in this project.
- Add a dependency the step file didn't ask for.
- Expand into a later step's scope.
- Commit.
