---
description: Run a Phase 1 step end-to-end — reads the step file, plans the work in plain English, asks approval, implements, verifies, stops before commit.
argument-hint: <step-number, e.g. 1 or 01>
---

Run Phase 1 step `$ARGUMENTS`.

The user has asked you to do work that's pre-specified in a step file. Your job is to: understand what the step asks, **explain it back to the user in plain English** so they can spot misunderstandings before any code is written, get approval, implement, verify, and stop. Communication discipline is the deliverable.

## 1. Find the step file

Pad `$ARGUMENTS` to two digits and find the matching file in `phases/phase-1/steps/NN-*.md`. If no file matches, stop and tell the user — do not guess a step number.

## 2. Read the contract

Read the step file. Internalise these fields:

- `Status:` — if it's already `done`, stop and ask the user if they really want to re-run it.
- `Maps to:` — also read the linked `phases/phase-1/PHASE_1_PLAN.md` §s.
- `Goal:` — the plain-English purpose (you'll quote this in the plan).
- `What lands:` — the concrete deliverables.
- `Depends on:` — if earlier steps' `Status:` is not `done`, warn the user and stop.
- `Verification:` — the exact command(s) that confirm success.
- `Done when:` — the success contract.
- `Guardrails:` — hard limits for this step.

Then re-read `CLAUDE.md §Hard rules` and `CLAUDE.md §Extensibility-first architecture`. They apply to every step.

## 3. Pick the helpers

Based on what the step touches, decide which project subagents / skills you'll use:

- Changes under `src/connectors/{lovable,supabase}/` → `mcp-policy-check` subagent before finishing.
- User-facing strings (reporters, CLI text, README) → `output-language-lint` subagent + `/check-trust-model`.
- New agent under `src/agents/<name>/` → `/new-agent` skill.
- New connector → `/new-connector` skill.
- New scanner adapter → `/new-scanner-adapter` skill.
- Any non-trivial diff → `plan-adherence` subagent at the end (confirms the diff matches `Done when:` and didn't drift into a "Not Required" item).

If none apply, say so explicitly in the plan.

## 4. Plan — communicate in plain English BEFORE asking approval

Enter plan mode. Write the plan **as if briefing a teammate who has not read the step file**. Use the exact section headings below, in this order. Each section has one job; don't merge them.

### Heading: `# Step NN — <short title from the step file>`

### Section: **"What this step does, in one paragraph"**

Quote the step file's `Goal:` section first (2–4 sentences). Then translate it into plain English ("In practice this means: …") so the user can sanity-check that you read the goal correctly. **No code, no file paths, no jargon** in this paragraph. If a reader who has never seen this repo can't understand it, rewrite.

### Section: **"Why we're doing it now"**

One sentence. What does this step unblock? Reference the step number(s) that depend on it. Example: "Step 02 has to land before step 03 can wire the CLI to the policy types it imports."

### Section: **"What you'll see when it's done"**

Concrete deliverables. Three sub-bullets max:
- **Files created or changed:** a short list (full paths, but ≤8 entries; if it's longer, group them — "5 files under `src/types/`").
- **New behaviour:** what becomes possible after this step. Example: "the orchestrator can now call `policy.enforce(...)` and get back a typed result." Plain English, not interface signatures.
- **What still won't work:** what the next step is for. Example: "the CLI still doesn't accept `--mode` — that's step 03."

### Section: **"How I'll check it worked"**

Quote the step file's `Verification:` line verbatim. Then explain:
- Which command runs (`pnpm typecheck`, a specific Vitest file, `mcp-policy-check`, etc.).
- What a passing run looks like in one sentence ("typecheck exits 0; no new files in `dist/`").
- What a likely failure mode looks like and what it means in one sentence ("if the EvidenceKind exhaustiveness test fails, I introduced a discriminator without updating its handler — I'll fix and re-run, not loosen the test").

### Section: **"What I need from you"**

This is the section the user is most likely reading. Be specific.

- **Approval to start:** always required (ExitPlanMode flow).
- **Decisions:** any open question the step file punts to the user (e.g. "step 13 says to choose between live sandbox and recorded fixtures — which do you want?"). If none, write "No decisions — the step file is self-contained."
- **Inputs:** any env var, key, file, or external resource the step needs (e.g. "`ANTHROPIC_API_KEY` set in the shell" for an AI-touching step). If none, write "No inputs."
- **What you'll review afterwards:** how you want them to verify your work (e.g. "skim the new types in `src/types/validation-policy.ts` and confirm the enum members match the plan"). Concrete actions, not vague "please review."

### Section: **"What I will not do (scope guard)"**

3–6 bullets, each one drawn from the step file's `Guardrails:` plus anything from `Phase 1 §6 / FPP §18 Not Required` that could plausibly creep in. Examples:
- "I will not implement any agent — that's steps 05–14."
- "I will not call any AI provider — Phase 1 is interface-only."
- "I will not change `PHASE_1_PLAN.md` — source of truth, separate change."

### Section: **"Helpers I'll call"**

The subagents / skills you picked in §3, with **one short reason each**. Example:
- `mcp-policy-check` — runs after the connector diff lands, confirms allowlist discipline.
- `output-language-lint` — runs on the report strings; required because step 13 changes user-facing text.

If you picked none, write: "No subagents needed — this step is pure types / pure infra."

### Section: **"Risks to watch for"**

2–4 bullets. Things that could go wrong and how you'll catch them. Examples:
- "Drift between `controls.ts` and `expected-findings.json`: caught by the consistency test in step 04."
- "Discriminated union grows without renderer: caught by the exhaustiveness test in step 13."

### Then call `ExitPlanMode` and WAIT for approval.

Do not start work before approval. Do not write code in the plan message itself.

## 5. Implement

Do the work as planned. If you discover the plan was wrong, **stop and re-plan** — never silently change scope. Tell the user what was wrong, ask whether to re-plan or adjust.

Use the subagents and skills you listed in the plan. Do not invent new helpers mid-flight.

Give brief progress updates at key moments (one sentence each): when you start a major file, when a subagent comes back, when verification is about to run. Don't narrate every Edit call.

## 6. Verify, then report clearly

Run the step's `Verification:` command(s). Then tell the user, in this exact structure:

### Helpers that may run during verification

- `mcp-policy-check` subagent if the step touched `src/connectors/`.
- `output-language-lint` subagent if the step touched user-facing strings.
- `plan-adherence` subagent for any non-trivial diff that touches multiple files.

These are scoped helpers, not the full review. The full review happens in §6.5 below.



### If verification passed

> **Verified.** `<command>` exits 0.
>
> **What was checked:** <one sentence summarising what the command actually validates — not just "tests pass," but "the artifact-store roundtrip and the policy-guard deny-path tests pass + typecheck is green.">
>
> **Files changed:** `git status --short` output (or a 1-line summary if 0–3 files).
>
> **What's next:** step `<NN+1>` is now unblocked. Want me to update this step's `Status:` to `done` and stop?

### If verification failed

> **Verification failed.** `<command>` exited `<code>`.
>
> **Which check broke:** <one sentence on what assertion / test / lint failed>.
>
> **What it means:** <one sentence on the root cause as far as you can tell>.
>
> **What I'd do next:** <one sentence — either "fix and re-run (within scope)" or "stop and surface this for your decision">.
>
> **What I will NOT do:** loosen the test or weaken the assertion to make it pass. The step file is the contract.

Do not auto-fix unless the fix is obviously inside the step's scope and you can name the fix in one sentence.

## 6.5 Mandatory end-to-end review by `step-reviewer`

**This section is NOT optional. The `/step` skill MUST NOT proceed to §7 (Status update) without completing §6.5. Skipping the review is a violation of the skill contract.**

After verification passes:

### 6.5.1 Spawn the agent (required)

Spawn the `step-reviewer` subagent with the step number. The agent reads the step file, the phase plan section(s) named in `Maps to:`, and the big-picture rules (`FPP §2A` extensibility, `§9` allowed-claims, `§18` not-required, `§10` finding model, MCP discipline, secrets discipline, typing discipline) — then reviews the diff against all three layers.

Quote the agent's full report back to the user verbatim under the heading **"Step review report"**. Do not summarise it; the user needs the unedited report.

### 6.5.2 Resolve every finding (do not just show the list)

For each `MUST-fix` and `SHOULD-consider` finding in the report, take ONE of the following actions. Default presumption: **reviewer findings are valid unless a specific rule lets you reject.** Document your choice next to the finding.

- **Apply.** Make the fix described in the finding's `How to fix:` line. Use the same Edit/Write discipline as §5. Mark the finding `[APPLIED: <one-line description of the actual change>]`.
- **Reject with reason.** Allowed only if one of these specifically holds:
  - The finding contradicts the step file's explicit scope (cite the line in the step file).
  - The finding misreads the diff (cite the actual diff content).
  - The finding asks for work outside the step's allowed surface (cite which rule limits scope).
  - The finding contradicts a settled decision in `phases/phase-N/decisions.md` or the step 01 record (cite the decision).
  Mark the finding `[REJECTED: <one-sentence reason citing specifically what is wrong>]`. If you cannot name what is specifically wrong in one sentence, you cannot reject — apply or surface.
- **Surface to user.** When you are genuinely unsure whether the finding is valid, or the fix is non-trivial and could change the step's scope. Mark the finding `[SURFACE: <one-line description of why the user should decide>]`.

You may NOT mark a finding `[IGNORED]`, `[N/A]`, or any equivalent. Every finding gets one of the three actions above.

### 6.5.3 Re-verify after Applies

If any finding was `[APPLIED]`, re-run §6 (the step's `Verification:` command). If it now fails, you broke something while applying — fix the new failure, then re-run again. Do not move to §6.5.4 until verification is green AND every finding has a resolution.

### 6.5.4 Re-review after Applies

If any finding was `[APPLIED]`, spawn `step-reviewer` a second time. New findings can appear after a fix lands. Repeat §6.5.2 → §6.5.3 → §6.5.4 until the agent returns either:

- `ship as-is` with zero MUST-fix and zero un-resolved findings — proceed to §6.5.5.
- A report whose only remaining MUST-fix findings are all `[REJECTED]` or `[SURFACE]`, with the user having explicitly OK'd the path — proceed to §6.5.5.

**Hard cap: 3 review cycles per step.** If the review hasn't converged after 3 cycles, stop, surface the state to the user, and ask whether to scope back or override.

### 6.5.5 Produce the consolidated summary

Show the user a single structured message:

```
Step review — final state

  Applied automatically: <count>
    - <file:line>: <one-line description of fix>
    - ...

  Rejected with reason: <count>
    - <file:line>: <one-sentence reason>
    - ...

  Awaiting your decision: <count>
    - <file:line>: <one-line description of why this needs you>
    - ...

  Verification: <command> → exit 0 (re-run after Applies)
  Final reviewer recommendation: <ship as-is | fix MUST-items, then ship | scope back>
```

Wait for the user's response. Only when the user signals OK (any of: "ok", "proceed", "ship it", "yes update status", or explicit override) do you move to §7. If the user wants further changes, return to §5 with their direction; do not silently update Status.

### 6.5.6 Fallback if `step-reviewer` is unavailable

If the agent fails to spawn or returns an error, fall back to `plan-adherence` (narrower scope: phase-plan adherence only). Note this explicitly in your summary: "Ran `plan-adherence` fallback because `step-reviewer` was unavailable; big-picture rules were not checked by an agent." Do not silently skip. The review is not optional — fallback is the floor.

## 7. Update the step file's Status header

You may update the Status header **only when ALL of the following are true**:

1. §6 verification command exited 0 (the most recent run, after any §6.5.3 re-verification).
2. §6.5 completed: every reviewer finding has an `[APPLIED]`, `[REJECTED: reason]`, or `[SURFACE]` resolution. No `[IGNORED]`, no skipped findings.
3. The reviewer's final cycle returned `ship as-is`, OR the user explicitly OK'd a final state that still has `[REJECTED]` or `[SURFACE]` items in it.
4. The user has signalled approval ("ok", "proceed", "ship it", "yes update status", or equivalent) AFTER seeing the §6.5.5 consolidated summary.

Then edit the step file. Change `**Status:** not started` to `**Status:** done (YYYY-MM-DD)`. Use today's date. If a commit hash is available (the user has already committed), append it: `**Status:** done (YYYY-MM-DD, commit <short-sha>)`.

If ANY of the four conditions is unmet, leave `Status:` as-is. Tell the user which condition is unmet.

## 8. Stop. Do not commit.

Show `git status` and `git diff --stat`. The user commits, not you. The diff is the deliverable.

## Hard rules (apply to every step, every time)

- Output language: only "checked," "found," "missing," "appears launch-blocking," "needs human review," "negative tests should be added." Never "secure," "safe," or "compliant."
- Heuristic findings → `likely_issue`, never `confirmed_issue`. Direct deterministic findings (Gitleaks, Semgrep direct-evidence rules) MAY be `confirmed_issue` per `FPP §11`.
- Gitleaks always with `--redact`. No raw secret values in artifacts, logs, or reports.
- Lovable MCP allowlist (Phase 1): `get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` (`plan_mode` + fixed templates only). Everything else forbidden.
- Supabase MCP: every call needs `read_only=true` AND `project_ref`. No `execute_sql`, no mutations, no user-row queries.
- No hardcoded provider names in shared types (per `FPP §2A`). `'lovable' | 'supabase'` style closed unions in `src/types/` or `src/core/` are forbidden — use `ConnectorId` / `ScannerId` / `AnalyzerId` opaque IDs.
- The "Not Required" lists in `PHASE_1_PLAN.md §6` and `FINAL_PRODUCT_PLAN.md §18` are binding — stop and ask before adding hosted dashboards, Slack, PR comments, autonomous remediation, or compliance claims.

## What you must never do

- Skip the plan or shorten it because "the step file already says everything." The plan is the user's review surface, not a copy of the file.
- Write the plan in jargon. If a paragraph contains more than one type name or file path, rewrite it in plain English.
- Pick subagents / skills that don't exist in this project.
- Add a dependency the step file didn't ask for.
- Expand into a later step's scope.
- Loosen a test or assertion to make verification pass.
- **Skip §6.5 (the `step-reviewer` review).** The review is the gate, not a suggestion. If the agent fails to spawn, run the `plan-adherence` fallback and mark it explicitly.
- **Silently dismiss a reviewer finding.** Every finding gets `[APPLIED]`, `[REJECTED: reason]`, or `[SURFACE]`. No `[IGNORED]`, no implicit "I didn't think it applied."
- **Reject a finding without naming what is specifically wrong in one sentence.** "Disagree" is not a reason; "the finding cites a file the diff didn't touch" is.
- **Update the Status header before §6.5.5's consolidated summary has been shown to the user AND explicit user OK has been received.**
- Commit.
