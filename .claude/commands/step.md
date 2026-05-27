---
description: Run a Veyra step (Phase 1 or Phase 2) end-to-end — reads the step file, plans the work in plain English, asks approval, implements, verifies, stops before commit.
argument-hint: <step-number> (e.g. `1` or `01` for Phase 1, `2.01` for Phase 2)
---

Run Veyra step `$ARGUMENTS`.

The user has asked you to do work that's pre-specified in a step file. Your job is to: understand what the step asks, **explain it back to the user in plain English** so they can spot misunderstandings before any code is written, get approval, implement, verify, and stop. Communication discipline is the deliverable.

## 1. Find the step file

Parse `$ARGUMENTS` as `<phase>.<step>` (e.g. `2.01`, `2.07b`, `3.30`). If no dot is present, default phase to `1` (so legacy invocations like `/step 03b` still resolve to Phase 1).

- `<phase>` must be `1`, `2`, or `3`. Any other value → stop and tell the user.
- `<step>` is the step identifier as it appears in the filename prefix: numeric (`01`, `02`, `30`), with an optional letter suffix (`02b`, `08c`, `10a`, `31b`, `31c`, `40b`). Zero-pad numeric values to two digits ONLY for phases 1 and 2 (their files are zero-padded, e.g. `01-`); phase 3 step files are NOT zero-padded (`30-`, `31-`, `31b-`), so use the number as written.
- **Phase folder mapping:** phase `1` → `phases/phase-1/steps/`; phase `2` → `phases/phase-2/steps/`; phase `3` → `phases/phase-2-improvement/steps/` (the "Agentic Veyra" phase — note the folder is `phase-2-improvement`, not `phase-3`).

Look up the matching file:

```
phase 1: phases/phase-1/steps/<step>-*.md
phase 2: phases/phase-2/steps/<step>-*.md
phase 3: phases/phase-2-improvement/steps/<step>-*.md
```

Examples:
- `/step 01` → `phases/phase-1/steps/01-*.md` (Phase 1 default)
- `/step 02b` → `phases/phase-1/steps/02b-*.md`
- `/step 2.01` → `phases/phase-2/steps/01-*.md`
- `/step 2.07b` → `phases/phase-2/steps/07b-*.md`
- `/step 2.10a` → `phases/phase-2/steps/10a-*.md`
- `/step 3.30` → `phases/phase-2-improvement/steps/30-*.md`
- `/step 3.31b` → `phases/phase-2-improvement/steps/31b-*.md`
- `/step 3.40b` → `phases/phase-2-improvement/steps/40b-*.md`

For phase 3, `Maps to:` references `phases/phase-2-improvement/PLAN.md` (+ `decisions.md`) instead of `PHASE_1_PLAN.md`.

If no file matches, stop and tell the user — do not guess. If multiple match (shouldn't happen given the naming convention), stop and ask the user to disambiguate.

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

### Then proceed to §4.5 (codex pre-review) before `ExitPlanMode`.

The plan is the message that will be sent to `ExitPlanMode`, but **before** it lands in front of the user, codex gets a chance to review it. The user only sees the plan after §4.5 has finished disposition-ing codex's findings — so they see the plan + a clean disposition record, not the raw plan alone.

## 4.5 Mandatory pre-review (codex as review backend, falls back to user approval)

**Goal: codex catches issues the user would otherwise have to catch by reading the plan. The skill dispositions each codex finding the same way it dispositions `step-reviewer` findings later (§6.5). Codex is a *review backend* — it does not replace the §6.5 protocol, it supplies the review content for it.**

### 4.5.0 Codex capability check + shared session warm-up (once per /step shell session)

The §4.5 plan review and the §6.5 diff review share the **same codex session** so the project context (FPP + P1 + P2 + REVISION_AI_SHAPE + step file + `CLAUDE.md` hard rules) is sent once, not twice. Workflow review logs and session state live under `.claude/`, never under Veyra's `scan-actions.log`.

#### Step 1 — Verify the local codex CLI

**Do not hardcode codex invocations.** Before any review call, run a one-time capability check (logged to `.claude/review-runs/<run-id>/codex-capability.json`):

```bash
codex --version 2>/dev/null
codex --help 2>/dev/null
codex exec --help 2>/dev/null
codex resume --help 2>/dev/null
codex review --help 2>/dev/null
codex fork --help 2>/dev/null
```

Document the verified subcommands and flag shapes in `.claude/codex-cli.json` (created on first run; persists across sessions until codex updates). The actual local CLI (verified against this skill) supports `codex exec`, `codex exec resume`, `codex review`, `codex fork`. **There is no `codex session` subcommand on this CLI**; session reuse goes through `codex exec resume <session_id>`. If a future codex update changes the subcommand surface, re-run this probe and update `.claude/codex-cli.json` before the next `/step` call.

#### Step 2 — Build the project context bundle

```
phases/FINAL_PRODUCT_PLAN.md
phases/phase-1/PHASE_1_PLAN.md
phases/phase-2/PHASE_2_PLAN.md
phases/phase-1/REVISION_AI_SHAPE.md
<the current step file>
CLAUDE.md (Hard rules + Extensibility-first sections)
```

Concatenate to `.claude/review-runs/<run-id>/context-bundle.md`. Compute `sha256` of the bundle.

#### Step 3 — Establish or reuse the codex session

Session token + bundle hash live in `.claude/codex-session-veyra.json`:

```json
{ "session_id": "<codex-returned-id>",
  "bundle_sha256": "<hex>",
  "warm_started_at": "<ISO8601>",
  "codex_version": "<from-step-1>" }
```

Reuse the existing session if `bundle_sha256` matches the freshly-computed bundle hash AND the codex version on disk matches. Otherwise: invalidate, re-warm, store a new token.

**Verified invocation** (against `codex exec` / `codex exec resume` as confirmed by the local CLI probe; recorded in `.claude/codex-cli.json` `verified_subcommands: ["exec", "exec resume", "review", "fork"]`):

```bash
# Warm the session: codex inspects the repo in read-only sandbox and ingests the bundle via stdin.
# --json emits JSONL so we can parse the session_id; -o writes the response transcript for audit.
codex exec -C "$REPO_ROOT" -s read-only --json \
  -o .claude/review-runs/<run-id>/codex-warm.jsonl - \
  < .claude/review-runs/<run-id>/context-bundle.md

# Parse the session_id from the JSONL response (codex exec emits one event with session_id).
session_id="$(jq -r 'select(.session_id != null) | .session_id' \
  .claude/review-runs/<run-id>/codex-warm.jsonl | head -1)"

# Persist the session token + bundle hash + CLI version for reuse across §4.5 and §6.5
bundle_hash="$(sha256sum .claude/review-runs/<run-id>/context-bundle.md | awk '{print $1}')"
cat > .claude/codex-session-veyra.json <<EOF
{ "session_id": "$session_id",
  "bundle_sha256": "$bundle_hash",
  "warm_started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "codex_version": "$(codex --version 2>/dev/null)" }
EOF
```

Subsequent §4.5 (plan review) and §6.5 (diff review) calls in this shell session **always** use `codex exec resume "$session_id"` against the saved token — codex pays the bundle cost once, not once per /step call. There is no `codex session new` / `codex session continue` in the verified CLI; using those would fail.

If the warm call fails (codex not on PATH, non-zero exit, empty `session_id`, or `bundle_hash` mismatch on a later check): fall through to §4.5.6 (no codex; user approval via `ExitPlanMode` + Claude `step-reviewer` fallback for §6.5).

#### Step 4 — Logging

Every codex call writes to `.claude/codex-review.log` (append-only) with:

```
{ run_id, step_id, phase: "plan" | "diff", verdict, finding_count, codex_version, bundle_sha256_short, duration_ms, exit_code }
```

**Never** to `scan-actions.log`. That file belongs to Veyra scan runtime; workflow automation has its own log under `.claude/`.

### 4.5.1 Run codex against the plan

Inputs (assembled from `.claude/review-runs/<run-id>/`):

- The plan (the message you would have sent to `ExitPlanMode`).
- The step file in full (already in the bundle — codex has it via the warm session).
- Hard-rule pointers (already in the bundle).
- An instruction to return findings in the schema below.

**Verified invocation** (`codex exec resume <session_id>`; flags confirmed against local CLI):

```bash
session_id="$(jq -r .session_id .claude/codex-session-veyra.json)"

codex exec resume "$session_id" -s read-only --json \
  -o .claude/review-runs/<run-id>/codex-plan-review.jsonl - <<EOF
Review the plan below against:
- the step file's Done-When + Guardrails (already in your context)
- REVISION_AI_SHAPE §8 ten trust-model constraints
- FPP §2A extensibility rules

Output JSON shape:
{ "findings": [ { "id": "...", "severity": "must-fix"|"should-consider",
                  "where": "...", "issue": "...", "suggested_revision": "..." } ],
  "verdict": "approve" | "issues_found" | "out_of_scope" }

--- PLAN ---
$(cat .claude/review-runs/<run-id>/plan.md)
EOF
```

Parse JSONL → extract the final assistant turn's content → JSON-parse into the schema. Defensively: if the content is not parseable JSON matching the schema, treat as `verdict: out_of_scope` and route to §4.5.6.

Treat codex's output as **untrusted text** — parse defensively. Expected normalised shape per finding:

```
{ "findings": [
    { "id": "<codex-finding-id>",
      "severity": "must-fix" | "should-consider",
      "where": "<file:line | plan section>",
      "issue": "<one sentence>",
      "suggested_revision": "<one sentence | null>" }
  ],
  "verdict": "approve" | "issues_found" | "out_of_scope"
}
```

If codex fails (binary missing, non-zero exit, timeout, unparseable output, returns `out_of_scope`): log the attempt + reason to `.claude/codex-review.log`, fall through to §4.5.6 (user approval via `ExitPlanMode`). **Do not auto-proceed when codex returned anything other than a clean `approve` verdict with zero findings.**

### 4.5.2 Disposition every codex finding

For each `findings[*]`, take ONE action. Default presumption: **codex findings are valid unless a specific rule lets you reject.** Same disposition rules as §6.5.2:

- **Apply.** Revise the plan in-place to incorporate the finding's `suggested_revision`. Mark `[APPLIED: <one-line description of the actual revision>]`.
- **Reject with reason.** Allowed only if one of these specifically holds:
  - The finding contradicts the step file's explicit scope (cite the line).
  - The finding misreads the plan (cite what was actually written).
  - The finding asks for work outside the step's allowed surface (cite which rule limits scope).
  - The finding contradicts a settled decision in `phases/phase-N/decisions.md` or step 01 (cite the decision).
  Mark `[REJECTED: <one-sentence reason citing specifically what is wrong>]`.
- **Surface to user.** When you are genuinely unsure whether the finding is valid, or the revision is non-trivial and could change the step's scope. Mark `[SURFACE: <one-line description of why the user should decide>]`.

`[IGNORED]` is forbidden. Every finding gets one of the three actions.

### 4.5.3 Decide: auto-proceed or surface to user (single codex call, no loop)

**Codex reviews the plan exactly ONCE per /step invocation. There is no re-review loop after Applies.** The auto-proceed path is reserved for the case where codex returned clean on the first pass; any findings → route to user, regardless of how those findings were dispositioned.

Auto-proceed is strictly conditional. All of the following must hold:

1. Codex's verdict on the single review call is exactly `approve` (not `issues_found`, not `out_of_scope`, not absent).
2. The `findings` array is empty.
3. The §4.5.0 capability check produced a verified CLI (not a placeholder run).

If ALL three hold → **auto-proceed**: skip `ExitPlanMode`, show the §4.5.4 summary, move to §5 (Implement).

If ANY one fails → **fall back to user approval**: call `ExitPlanMode` with the plan + codex's findings + the skill's disposition record (the `[APPLIED]` / `[REJECTED]` / `[SURFACE]` markings from §4.5.2) + the explicit reason auto-proceed was denied (e.g. "codex returned issues_found with 2 findings" / "codex returned out_of_scope" / "verified CLI not available"). Wait for user.

This is the asymmetric default the user asked for: clean codex approval auto-proceeds; anything else waits. The skill dispositions findings to give the user a clean reading surface — but does NOT re-ask codex to confirm the dispositions. Re-asking would mean another token round-trip with the same context for marginal gain; the user is the right oracle for "is the disposition acceptable?"

### 4.5.4 Show the user a consolidated summary

Whether auto-proceeding or waiting, the user gets **one message** with this structure:

```
Plan pre-review — codex disposition

  Applied automatically: <count>
    - <plan section>: <one-line description of revision>
    - ...

  Rejected with reason: <count>
    - <plan section>: <one-sentence reason>
    - ...

  Awaiting your decision: <count>     (only if any [SURFACE])
    - <plan section>: <one-line description of why this needs you>
    - ...

  Codex verdict: approve | issues_found | out_of_scope
  Mode: auto-proceeded | waiting for your approval
```

If `auto-proceeded`: continue to §5 immediately. The user can interrupt if they disagree, but the skill doesn't wait.

If `waiting for your approval`: the message above is followed by `ExitPlanMode`. Standard approval flow applies.

### 4.5.5 Fallback when codex is unavailable, unparseable, or out-of-scope

Trigger conditions (any one):

- `codex` binary not on `PATH`.
- §4.5.0 capability probe never completed successfully on this machine.
- Non-zero exit from the review call.
- Timeout (configurable; default 60s).
- Unparseable output (cannot be normalised to the §4.5.1 schema).
- Codex returns `verdict: out_of_scope`.

Behaviour:

- Log the attempt + the specific failure reason to `.claude/codex-review.log` (never to `scan-actions.log`).
- Note in the §4.5.5 summary: "codex pre-review fell back to user approval — reason: <one-line>."
- Call `ExitPlanMode` with the plan + whatever partial codex output existed (so the user can see what codex did manage to say).
- The §4.5 section ran; it just routed to user approval. Do not silently skip the section entirely.

### Then call `ExitPlanMode` (only when §4.5.3 routes to user), or move to §5 directly (when §4.5.3 auto-proceeds)

Do not start work before either (a) `ExitPlanMode` approval, or (b) §4.5.3 auto-proceed condition. Do not write code in the plan message itself.

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

## 6.5 Mandatory end-to-end review (codex primary, `step-reviewer` fallback)

**This section is NOT optional. The `/step` skill MUST NOT proceed to §7 (Status update) without completing §6.5. Skipping the review is a violation of the skill contract.**

After verification passes:

### 6.5.0 Reuse the shared codex session from §4.5.0

§6.5 is the final-diff review. It is **not a separate codex invocation chain** — it reuses the same warmed session that §4.5 used for the plan. The bundle (FPP + P1 + P2 + REVISION + step file + CLAUDE.md hard rules) is already in codex's context; this call adds only the marginal inputs below.

If the §4.5.0 capability check resulted in fallback-only mode (no verified CLI), this section ALSO falls back — to the Claude `step-reviewer` subagent — per §6.5.6.

### 6.5.1 Run the diff review (codex primary, Claude `step-reviewer` fallback)

**Primary path — codex against the actual implementation, reusing the warm session.** Inputs (assembled into `.claude/review-runs/<run-id>/`):

- `git diff HEAD` — the implementation diff. Written via `git diff` itself (binary files are excluded by default; large diffs are bounded by the same review-run truncation guards used elsewhere).
- The **approved plan** from §4.5 (snapshot saved to `<run-id>/plan-snapshot.md` so codex can check the diff against what was planned, not just against the step file).
- The **verification output** from §6 (stdout + stderr + exit code of the step's `Verification:` command). Codex uses this to confirm tests actually passed, not just that the diff lands.
- (The step file in full is already in the warm session's bundle — not repeated as an input.)

**No shell-side `cat` loop over modified files.** Codex inspects the repo itself in read-only sandbox via the `-C` and `-s read-only` flags — it pulls additional file context as needed without raw `cat` (which would break on filenames with spaces, deleted files, binary files, and oversize content). The diff + plan + verification artifacts are the bounded text inputs we provide; everything else, codex sees in the sandboxed working tree.

**Verified invocation** (`codex exec resume <session_id>`; flags confirmed against local CLI):

```bash
session_id="$(jq -r .session_id .claude/codex-session-veyra.json)"

# Bounded text artifacts: diff + verification + plan snapshot
git diff HEAD > .claude/review-runs/<run-id>/diff.patch
cat > .claude/review-runs/<run-id>/verification-output.txt <<EOF
=== verification command exit code: $VERIFY_EXIT_CODE ===
--- stdout ---
$(cat .claude/review-runs/<run-id>/verify-stdout.txt 2>/dev/null)
--- stderr ---
$(cat .claude/review-runs/<run-id>/verify-stderr.txt 2>/dev/null)
EOF
cp .claude/review-runs/<run-id>/plan.md .claude/review-runs/<run-id>/plan-snapshot.md

codex exec resume "$session_id" -C "$REPO_ROOT" -s read-only --json \
  -o .claude/review-runs/<run-id>/codex-diff-review.jsonl - <<EOF
Review the implementation against:
- the step file's Done-When + Guardrails (already in your context from §4.5.0 warm-up)
- the approved plan (below)
- the verification output (below)
- the ten trust-model constraints in REVISION_AI_SHAPE §8
- FPP §2A extensibility rules

You have read-only access to the working tree in your sandbox; consult files there for any context beyond the diff hunk. Do NOT modify anything.

Output JSON: same shape as the plan-review schema, three-line per finding (where / violation / how-to-fix), with verdict.

--- DIFF (git diff HEAD) ---
$(cat .claude/review-runs/<run-id>/diff.patch)

--- VERIFICATION OUTPUT ---
$(cat .claude/review-runs/<run-id>/verification-output.txt)

--- APPROVED PLAN ---
$(cat .claude/review-runs/<run-id>/plan-snapshot.md)
EOF
```

Parse JSONL → extract the final assistant turn → JSON-parse → normalise to `step-reviewer`'s three-line per-finding shape.

Parse codex's output into the same shape `step-reviewer` produces. Quote it verbatim under heading **"Step review report (codex)"**.

**Fallback path — Claude `step-reviewer` subagent.** Triggered when any of:

- §4.5.0 capability check produced a placeholder/fallback-only CLI state.
- codex returned non-zero exit or unparseable output for this diff review.
- session token from `.claude/codex-session-veyra.json` is stale (bundle hash mismatch) and re-warm fails.
- the user passed `--no-codex-review`.

Spawn the `step-reviewer` Claude subagent (existing path). Quote its report under heading **"Step review report (claude step-reviewer fallback)"**.

**The §6.5.2 disposition rules apply identically to either reviewer's output.** The review is the gate; only the source changes between codex and Claude.

Every review attempt (codex or fallback) writes a row to `.claude/codex-review.log`. Never to `scan-actions.log`.

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

### 6.5.4 Decide: clean handoff or surface to user (single review call, no loop)

**Codex (or `step-reviewer` fallback) reviews the diff exactly ONCE per /step invocation. There is no re-review after Applies.** Same rule as §4.5.3 for the plan stage: clean verdict on the single call auto-routes to §6.5.5; any findings → consolidated summary → surface to user for Status-update OK.

Cases:

- **Reviewer's verdict was `approve` / `ship as-is` on the first call AND zero findings:** route directly to §6.5.5 with `mode: clean — no findings`. User sees the empty disposition list and gives the explicit Status-update OK per §7.
- **Reviewer's verdict was anything else (`issues_found` / findings emitted):** apply the §6.5.2 disposition (`[APPLIED]` / `[REJECTED]` / `[SURFACE]`), re-run §6.5.3 verification once if any `[APPLIED]` change made it to the diff, then route to §6.5.5. Do NOT re-spawn the reviewer to check the post-Apply state. The user is the oracle for "did the applied fix land correctly?" — they see the dispositions in §6.5.5 and decide.

If the re-verification at §6.5.3 fails (i.e. an Applied fix broke `pnpm typecheck` or the step's test command), surface to user with the failure included; do NOT silently retry or re-ask the reviewer.

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

### 6.5.6 Fallback chain when reviewers are unavailable

Primary: codex (see §6.5.1) — reuses the session warm-up; cheapest path.

First fallback: Claude `step-reviewer` subagent — fuller-context review at higher Anthropic-token cost. Used automatically when codex is unavailable or returns an error, OR when the user passes `--no-codex-review`.

Second fallback: `plan-adherence` Claude subagent — narrowest scope (phase-plan adherence only); no big-picture rule check. Used only if both codex AND `step-reviewer` fail to run. Note explicitly in your summary: "Ran `plan-adherence` second-fallback because both codex and `step-reviewer` were unavailable; big-picture rules were not checked." Do not silently skip. The review is not optional — fallback is the floor.

## 7. Update the step file's Status header

You may update the Status header **only when ALL of the following are true**:

1. §6 verification command exited 0 (the most recent run, after any §6.5.3 re-verification).
2. §6.5 completed: every reviewer finding (codex OR Claude `step-reviewer` fallback) has an `[APPLIED]`, `[REJECTED: reason]`, or `[SURFACE]` resolution. No `[IGNORED]`, no skipped findings.
3. The reviewer's final cycle returned a clean verdict (codex `approve` or `step-reviewer` `ship as-is`), OR the user explicitly OK'd a final state that still has `[REJECTED]` or `[SURFACE]` items in it.
4. **The user has signalled explicit approval** ("ok", "proceed", "ship it", "yes update status", or equivalent) AFTER seeing the §6.5.5 consolidated summary. **Codex's clean verdict does not bypass this.** Auto-proceed is allowed at §4.5 (plan stage) but NEVER at §7 (Status-update stage). Status: done always requires an explicit human signal.

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
- **Skip §6.5 (the mandatory review).** The review is the gate, not a suggestion. The reviewer can be codex (primary) or `step-reviewer` Claude subagent (fallback), but the section runs.
- **Skip §4.5 when codex is available.** Codex is the plan-review backend. If codex is unavailable, §4.5.6 routes to `ExitPlanMode` — but the section ran.
- **Silently dismiss a reviewer or codex finding.** Every finding gets `[APPLIED]`, `[REJECTED: reason]`, or `[SURFACE]`. No `[IGNORED]`, no implicit "I didn't think it applied."
- **Reject a finding without naming what is specifically wrong in one sentence.** "Disagree" is not a reason; "the finding cites a file the diff didn't touch" is.
- **Auto-proceed past §4.5 unless ALL of §4.5.3's three conditions hold.** Specifically: codex must return exactly `verdict: approve` with an empty `findings` array, AND the CLI must have been verified (not placeholder). Anything ambiguous → `ExitPlanMode`.
- **Auto-proceed past §6.5 (or §7 Status-update) on the reviewer's verdict alone.** Auto-proceed exists only at §4.5 (plan stage, single codex call, clean verdict). Status: done always requires explicit human approval, regardless of how clean the diff review came back.
- **Hardcode codex CLI commands** without first verifying them at §4.5.0 capability check. Invocations must be confirmed against `.claude/codex-cli.json` before use.
- **Write codex/workflow review logs to `scan-actions.log`.** That file is Veyra scan runtime, not workflow automation. All review-related logging goes to `.claude/codex-review.log` and per-run state to `.claude/review-runs/<run-id>/`.
- **Re-ask codex (or the `step-reviewer` fallback) after applying its feedback.** One review call per stage. After §4.5.2 / §6.5.2 disposition lands, do NOT loop back to ask the reviewer again. The user is the oracle for "did the Apply land correctly?" — they see the dispositions and decide. Re-asking burns tokens for marginal gain.
- **Run §6.5.3 re-verification more than once per /step invocation.** If an `[APPLIED]` fix triggers a re-verification and that re-run fails, surface to user with the failure included. Do NOT loop on verification.
- **Update the Status header before §6.5.5's consolidated summary has been shown to the user AND explicit user OK has been received.**
- Commit.
