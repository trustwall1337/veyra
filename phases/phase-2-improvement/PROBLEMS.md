# Phase 2 Improvement — Problem Statement

**Status:** problem statement (no solutions; planner reads this and proposes a plan)
**Date:** 2026-05-26
**Reader:** the phase-planner agent (and codex reviewing the planner's output)

This file describes what the project tried to be, what was built, and where the result fell short of "smart." It contains no proposals, no architecture decisions, no options. The planner's job is to read this honestly, propose how to fix it, and have its proposal reviewed by codex before any step file lands.

## Product positioning — stated by the product owner (2026-05-26)

> *"We are building Artificial General Intelligence tools, not traditional."*

This is the load-bearing framing for everything that follows. Read every Observation below through this lens. The right question is not *"how do we add more AI to the deterministic shell?"* — it is *"does the existing architecture reflect a tool built as AGI, or as traditional security tooling with AI bolted on?"* If the answer is the latter (and the evidence in the appendix below suggests it is), the planner's task is to confront the foundation, not to patch surfaces.

Traditional security tooling has a deterministic floor with optional AI enrichment. An AGI-class tool is one where intelligence is the substrate: the system reasons about the customer's specific app, derives what to check from understanding rather than from a fixed list, authors its findings as a thinking analyst would, and only uses deterministic scanners as evidence sources for that reasoning. The planner is expected to take this positioning at face value, not soften it back into "smarter AI bolt-on."

## Architectural direction — clarified by the product owner (2026-05-26, supersedes prior PLAN-v1)

A first planning cycle (4 planner rounds, 3 codex review rounds — recorded under `superseded/PLAN-v1-deterministic.md`) produced a plan where AI sits as an analyst over deterministic-collected evidence. The product owner explicitly rejected that frame on 2026-05-26 with three directives:

1. *"HTTP method, URL pattern, body shape — we need this as well [not catalog-fixed]."*
2. *"Every tool invocation goes through a policy gate AI calls dynamically — AI will decide which tools needs to be run."*
3. *"Orchestrator becomes an AI loop, not a topo-sort."*
4. *"We should be agentic and smart."*

This means the orchestrator is replaced by an agentic loop. AI decides which tool to invoke next, with which parameters, based on the artifacts collected so far. Every tool invocation passes through a policy gate AI must call before the tool runs; the gate is deterministic and enforces the same MCP / scanner / secrets / output-language rules CLAUDE.md already binds. AI is not "an analyst" — AI is the orchestrator itself, bounded by the policy gate, the catalog of available tools, and the citation linter that gates emitted Findings.

Concretely, the planner must:

- Design an agentic-loop orchestrator (`src/core/orchestrator/agentic-loop.ts` or successor) that replaces `scan-orchestrator.ts`'s topo-sort.
- Define how every existing Phase 1 / Phase 2 agent is exposed as an AI-callable tool with a typed tool schema and a per-tool policy gate.
- Define how the AI loop terminates (budget cap, "done" signal, fallback under `--no-ai`).
- Preserve every binding constraint in CLAUDE.md (MCP allowlists, secrets discipline, output language, validation policy capability gating, extensibility-first opaque ID types).
- Carry over the Phase 1/2 trust-model invariants that the prior PLAN-v1 preserved (deterministic classification, citation-linted Findings, mandatory deterministic floor, redaction, cleanup discipline) — restated in agentic terms.

The 10 Observations in the appendix below remain valid. The Evidence appendix's file-line citations remain ground truth. The architectural direction stated here changes the **answer shape** the planner produces (agentic loop, not topo-sort), not the **problem shape** (the 10 Observations + evidence).

### Codex review budget for the new plan

Three fresh codex rounds for the new agentic-pivot plan (product-owner directive 2026-05-26, superseding an earlier "2 rounds" instruction in the same session — final decision is **3 rounds**). The planner may iterate without codex limit between codex rounds. Total codex review surface: 3 rounds on the plan + 1 round per step file when step files are authored. The README update is reviewed independently per its own codex pass (PROBLEMS.md §"Deliverables that follow plan approval"); that review does not count against the plan's 3-round budget.

## What Veyra is supposed to be

Veyra is a security-readiness CLI for AI-built SaaS applications, starting with Lovable + Supabase apps. The product story (from `phases/FINAL_PRODUCT_PLAN.md` and `phases/phase-1/PHASE_1_PLAN.md`) is "one command, one token, one report" — the customer gives Veyra access to their app + their database and gets back an actionable, app-specific security report.

The user (the product owner) has been consistent across every conversation since the project started about what "smart" means. Selected quotes (from this and earlier sessions):

> *"I as user expected all done by tools, no manual works."*
> *"Veyra should be smart to find and know it."*
> *"we are far from smart, take your time, think out of box and see how we can be smart, this is very critical."*
> *"I asked you from start we should be smart and creative, now seems everything is build in traditional way."*
> *"not only my comment — what we build so far in this plan needs to be reviewed to see if there is room to make it smart."*

The product was meant to FEEL smart to the operator. It does not.

## What was actually built (Phase 1, completed)

The deterministic-baseline pipeline:

- A fixed catalog of 12 controls (`cc-11-1` through `cc-11-12`), identical for every customer's app.
- Seven agents executed in topological order: `product-understanding`, `tool-runner`, `authn`, `authz-tenant`, `supabase-rls`, `business-logic`, `evidence-report`.
- Static analysis via three scanner adapters: `gitleaks`, `osv-scanner`, `semgrep`.
- A Supabase REST backend that reads schema metadata, storage buckets, storage config (after the step 27 course correction).
- A `CodeSource` abstraction for the file-walking layer (after step 28a).
- An AI Inference Agent (`08d`) that produces `Hypothesis[]`, but its output is segregated into an "AIConcerns" tier in the report, not used as primary reasoning.
- An AI Product-Understanding step (`17c`) that produces a declared-context narrative, but is opt-in (`--ai-provider` required) and only enriches what the deterministic file-walk already produced.
- A reporter that renders per-control cards with a fixed shape; AI fills slots, AI does not author the narrative.
- A fixture validation gate ensuring deterministic findings match expectations against a seeded vulnerable example.

## What was actually built (Phase 2, completed 2026-05-26)

The active-validation pipeline (currently not invokable end-to-end via CLI; that's deferred to step 29):

- Mode B with two sub-modes: B.1 (manifest mode — operator declares test users and their owned data in a YAML file) and B.2 (auto-synthesize — Veyra creates synthetic users via the service-role key).
- A sandbox executor with `ValidationPolicy.allowed_actions` gating.
- A negative-test catalog (one file per control_id) — human-authored test types.
- An AI Security Planner (step `07b`) that picks catalog entries based on declared context; bounded to the catalog by a `planner-output-is-subset-of-catalog` test.
- A sandbox runner that executes the compiled plan: signs in as test actors, fires PostgREST requests, asserts outcomes (`proven_allowed` / `proven_denial` / `inconclusive`).
- A two-phase orchestrator (Exercise + Cleanup) with mandatory cleanup even on crash.
- An AI Explainer agent (step `09`) that comments on findings one-by-one.

## Where the project fell short of "smart" — observations only

### Observation 1 — Controls are universal, not app-specific

Every customer's project gets the same 12 controls. A SaaS dashboard, an e-commerce store, an insurance evaluator, a marketplace — Veyra checks identical things. The controls catalog was not designed to be derived from the customer's app shape; it was authored once and applied uniformly.

When the actual app has a state-machine pattern (Draft → Submitted → Approved), there is no control for "illegal state transition." When the app has a payments table, there is no control for "PCI-style sensitive column exposure" beyond the generic `cc-11-7` regex on env-var names. The catalog has no path for app-specific controls to be added at scan time.

### Observation 2 — AI is segregated, not central

AI appears in two places: as an "Inference" agent that produces `Hypothesis[]` (which then either get attached to deterministic findings or surface as `AIConcerns`), and as an "Explainer" agent that comments after the fact. AI never reasons FIRST. AI never decides what to check. AI never authors the report. AI never picks the actors. AI never composes multi-step probes. AI never synthesises across findings.

The architectural choice was: **deterministic is the floor; AI is a small enrichment tier.** The trade-off was made for auditability, but the consequence is a product whose smart parts are invisible to the customer reading the report.

### Observation 3 — Test types in Phase 2 are catalog-bound; AI cannot invent

Phase 2 step 01 preventer decision 9 explicitly locks: customers cannot author custom executable test types in Phase 2; only catalog entries with valid parameters. The reasoning was to prevent AI from inventing destructive probes. The consequence: even the AI Security Planner cannot propose "for an insurance-evaluation app, the load-bearing IDOR is between two reviewers" because the catalog has no entry for that specific composition.

### Observation 4 — Operator inputs are over-specified

To run Mode B today (post step 29 if that ships), the operator must:

1. Manually create 2–3 test users in Supabase Dashboard.
2. Manually assign roles to them in the user_roles table.
3. Manually seed owned data per user (so cross-tenant tests have targets).
4. Manually write a YAML manifest declaring all of the above.
5. Manually export passwords to env vars.
6. Manually write an approval file.
7. Run the scan.

Compare to what the user expected: provide a sandbox project + credentials, run one command. Every manual step above is a step Veyra could in principle figure out itself (sign in via JWT secret, discover users from `auth.users`, infer roles from `user_roles`, probe ownership at runtime), but the existing architecture made each of those operator-provided inputs.

### Observation 5 — Schema parsing is regex-based and brittle

Step 26 fixed the regex parser for real `pg_dump` syntax, but the underlying choice (regex, not semantic) means the parser sees text, not meaning. The Supabase REST path doesn't expose RLS USING/WITH CHECK bodies, so policy-level findings rely on a SQL-dump that the customer must provide. AI is not invited to interpret the schema's MEANING (e.g., "this looks like a multi-tenant table joined on team_id") — only to enrich after the fact.

### Observation 6 — The report is per-control, not per-app

The report renders 12 control cards. Each is a slot. Each finding fills a slot. There is no top-level narrative explaining the customer's security posture as a whole. There is no root-cause synthesis ("you have three IDOR findings, all caused by your team_id RLS pattern; the fix is one policy change"). There is no priority order rooted in the customer's app type. There is no fix recommendation grounded in the customer's actual code.

### Observation 7 — Coverage gaps are templated

When a check cannot run (REST does not expose policy bodies, gitleaks not installed, etc.), the resulting `coverage_gap` finding uses templated text. AI is not invited to contextualize the gap to the customer's app. The customer reading the report sees "REST does not expose policy bodies" without "and for YOUR app this matters because…"

### Observation 8 — Findings classification is deterministic

`likely_issue` vs `confirmed_issue` is decided by hardcoded rules (canonical-name-list match → confirmed; pattern match → likely). AI is not invited to judge confidence based on the broader context (e.g., "this hardcoded key looks like a real Stripe secret, not a test fixture, based on the surrounding code"). Confidence calibration is purely structural.

### Observation 9 — Customer-facing flag set is large

Today's CLI: `--project`, `--out`, `--json`, `--fail-on-blocker`, `--mode`, `--env`, `--lovable-mcp`, `--lovable-project`, `--supabase`, `--supabase-mcp`, `--supabase-schema`, `--no-ai`, `--ai-provider`, `--ai-hypothesis-budget`, `--ai-concern-threshold`, `--ai-cache-ttl`, `--ai-model`. After step 29: also `--approve-active`, `--approval-file`, `--test-actor-manifest`, `--supabase-sandbox`, `--ci`. A "smart" tool would infer most of these — the project root reveals whether it's Lovable, the schema reveals whether it's Supabase, the absence of an API key reveals `--no-ai`, etc.

### Observation 10 — Phase 2 Improvement (just attempted by Claude) repeated the pattern

The vision doc Claude wrote on 2026-05-26 (since deleted) proposed two AI-bolted-on improvements: a "Smart Planner v2" (more sophisticated catalog picker) and a "B.0 auto-discover" (use JWT secret to skip manifest creation). Both improvements were ADDITIVE on top of the deterministic-first architecture. Neither questioned whether the deterministic-first architecture itself was right. The user explicitly called this out: *"everything is build in traditional way."*

## Symptoms the operator experiences today

Concrete failure modes the user has hit during 2026-05-25/26 testing:

- "Why do I have to dump my schema manually?" — Phase 1 originally required `supabase db dump` until step 27 / 28a corrected to REST + CodeSource.
- "Why is the report saying my schema has 41 tables but the artifact is empty?" — step 26 fixed the silent-empty parse; step 27 still didn't persist the discovered table names (deferred to step 29).
- "Why does the Lovable token I just got fail?" — Veyra was wired for a static-token model that Lovable's MCP does not use (OAuth-only). Step 28b is paused on this.
- "Why is `--supabase-mcp` a no-op?" — step 24 fixed registration; step 25 added transport; step 26 fixed parser; step 27 demoted MCP to alternative backend in favour of REST. Four steps to deliver one flag that should have worked.
- "Why do I need a YAML manifest, env-var passwords, AND an approval file just to start testing?" — manifest mode (B.1) is the documented Phase 2 default per preventer 10.
- "Why is the report templated and not telling me what to actually fix?" — per-control cards; no narrative.

Each of these is a real friction point from a real customer-shaped session.

## What the planner is asked to do

Read this problem statement honestly. **Do not assume the answer is "add more AI on top."** Question every architectural choice listed in Observations 1–10. Ask whether the deterministic-first foundation was right, or whether smart-first would have produced a different system. Propose how to evolve the project — including which parts of Phase 1 + Phase 2 should be revisited, not just extended.

Concrete deliverables the planner produces:

1. A diagnosis: which observations represent fundamental architectural issues vs which represent surface-level fixes.
2. A proposed phase structure: how to evolve the project to be smart-first (or to honestly close the gap between what was built and what the user expected). The planner decides whether this is one new phase, multiple, or amendments to existing phases.
3. An ordered list of steps the planner believes should be created, with one-paragraph each on what the step changes and why it is in the position it is.
4. An honest accounting of what existing Phase 1 / Phase 2 work would need to be amended, deprecated, or rebuilt — and the cost of doing so.
5. Decisions the user must make (planner identifies them; user picks later).
6. Decisions the planner picks itself (with one-line justification each).

The planner does NOT write step files; it proposes the plan. After codex review of the plan (multi-round if needed), step files are authored by Claude separately.

## Constraints the planner MUST honour

These are non-negotiable; the planner may not propose work that violates them.

- CLAUDE.md `§Output language` — only allowed claims in any user-facing string ("checked / found / missing / appears launch-blocking / needs human review"). Never "secure / safe / compliant."
- CLAUDE.md `§Secrets` — no raw secret values in any artifact, log, AI prompt, or report. Token-in-env-var is the only credential surface.
- CLAUDE.md `§MCP discipline` — Lovable allowlist (`get_project, list_files, read_file, list_edits, get_diff, send_message`), Supabase MCP `read_only=true + project_ref` per call.
- CLAUDE.md `§Extensibility-first` — opaque ID types; no closed provider unions in shared types.
- CLAUDE.md `§Validation policy` — capability gating by `allowed_actions`; never binary `read_only`.
- FPP §18 (Not Required) — no hosted dashboard, no Slack, no PR comments, no autonomous remediation, no compliance claims.
- Phase 2 step 01 preventer decisions 7–10 — live-endpoint smoke required; representative dev/sandbox-project gate; catalog-bound executable-test universe; manifest-as-documented-default-Mode-B-path (planner may propose amendment of this last one but must surface it as such).

## Things the planner explicitly may propose

- That AI become the primary reasoning layer with deterministic data as evidence, not the other way around.
- That existing agents be amended, rebuilt, or replaced.
- That the controls catalog be derived from the app, not fixed.
- That the operator surface shrink to a minimum (e.g., 2–3 env vars and a project pointer).
- That trust-model concerns be re-discussed with codex if a smart-first architecture needs them rebalanced.
- That preventer decisions 7, 8, 9, 10 be revisited (with explicit amendment).

The planner is not obligated to propose all of these. The planner is obligated to think honestly.

## Review process

1. Phase-planner agent reads this file end-to-end, produces a plan.
2. Plan is sent to codex for review.
3. Codex findings applied; planner re-reviewed.
4. Iterate until codex returns "apply-as-is" or equivalent.
5. Plan informs step file creation; each step file is also reviewed with codex.

The goal of this loop is honest planning, not fast planning. Take the rounds it takes.

## Deliverables that follow plan approval (required, not optional)

Once the plan has passed codex review and the user has explicitly approved it, the following deliverables land BEFORE any step starts implementation. Each is itself reviewed with codex:

1. **`README.md` update — critical.** The top-level project README must be updated to reflect the AGI-class positioning stated at the top of this document and the architectural pivot the approved plan describes. The current README frames Veyra as a deterministic CLI with optional AI enrichment; the post-plan README must frame it as the AGI-class product the owner has stated it is. Wording goes through `output-language-lint` per CLAUDE.md `§Output language` (only allowed claims). **This README update is mandatory and must itself be reviewed with codex** — not as a polish item after step files ship, but as the public-facing reflection of the plan's intent. Drift between the README and the plan is itself a failure mode this loop must prevent.
2. **`CLAUDE.md` amendments** — any new resolved engineering decisions, any preventer-decision amendments (e.g. preventer 10), and any new "Hard rules" entries needed by the plan. Reviewed with codex.
3. **`phases/phase-2-improvement/decisions.md`** — the canonical record of every decision the user ratified, every decision the planner picked, and every decision codex rebalanced. Future planner runs consult this file.
4. **A new section in `FINAL_PRODUCT_PLAN.md`** if (and only if) the plan changes the product story enough that the existing §10–§12 wording is no longer accurate. The planner identifies whether this is needed; codex confirms.

If any of the four deliverables drifts from the approved plan, the drift is itself a finding and the loop reopens.

## Evidence appendix — verification of each Observation against the actual codebase (high confidence)

Every claim in Observations 1–9 has been verified by reading the cited files in `src/` and `phases/` on 2026-05-26. The planner should not re-litigate the facts; only their consequences.

### Obs 1 evidence — the 12-control catalog is literally closed in source

`src/agents/evidence-report/controls.ts` defines `const CONTROLS` as a flat literal array of entries with hardcoded `control_id` values `'cc-11-1'` through `'cc-11-13e'` (lines 35–161; 17 controls total in the catalog including Phase 2's `cc-11-13a..e`). The `findControl(id)` lookup at line 171 returns `undefined` for any id not in this list. The file's header comment (line 4) states the catalog is canonical and *"renaming any of them requires"* a coordinated change. There is no app-derivation function in the file, no registry of additional controls, no mechanism for a scan to extend the catalog at runtime.

### Obs 2 evidence — AI is structurally forbidden from authoring Findings

`src/agents/ai-inference/agent.ts:5` (header comment): *"Never produces Findings (constraint 7) or AIConcerns (Pass-2 owns those)."* The agent's only output type is `Hypothesis` (line 18 import; line 28 artifact filename `hypotheses.json`). `src/agents/ai-explainer/agent.ts:9` (header comment, quoting REVISION_AI_SHAPE §10.2): *"AI never classifies. AI never decides what to fix."* `phases/phase-1/PHASE_1_PLAN.md:439`: *"AI never produces `confirmed_issue` classifications."* `phases/phase-2/steps/README.md:24`: *"AI never sets `finding_type`, `evidence_strength`, `review_action`, `blast_radius`, `readiness_status`. AI never decides what to fix or what to block."*

### Obs 3 evidence — Phase 2 test types are catalog-bound and drift-guarded

`src/agents/sandbox-runner/test-catalog/` contains exactly 13 catalog files plus `drift-guard.test.ts` and `index.ts`. The test file `src/agents/ai-security-planner/agent.test.ts:102` enforces the rule by name: *"planner-output-is-subset-of-catalog (constraint 4)."* No file in the repo allows test-type authoring at scan time.

### Obs 4 evidence — manifest required fields per type definition

`src/types/test-actor-manifest.ts:36–55` defines `TestActorEntry` requiring `email`, `password_env`, `role`, plus optional `tenant_id` and `owns: readonly OwnedResource[]`. The manifest top-level (line 50–53) requires both `roles: Record<string, TestActorRoleRule>` (with `can_access` / `cannot_access` arrays) AND `test_actors: readonly TestActorEntry[]`. Every required field is operator-supplied; none is currently derived at scan time.

### Obs 5 evidence — parser is regex/line-based by explicit design

`src/agents/supabase-rls/parser.ts:1–2` (file header): *"Regex/line-based parser for `supabase db dump` output."* The file enumerates known misses (CTEs, DO blocks, multi-statement policies, UDF bodies, non-public schemas) and acknowledges them in `unparseable[]` rather than via semantic interpretation.

### Obs 6 evidence — report renders per-control cards, no narrative authoring path

`src/reporters/markdown/reporter.ts:159` defines `renderControlCards(report)`. The function loops over `report.control_cards` (line 164). Three other iteration sites at lines 313, 329, 344 are also per-control-card. No `renderNarrative` / `renderAppSummary` / `renderRootCauseSynthesis` function exists anywhere in `src/reporters/`. The report shape is structurally per-control-only.

### Obs 7 evidence — coverage_gap rendering goes through templated strings, no AI

The reporter's coverage-gap-relevant string (`src/reporters/markdown/strings.ts:47`) is a static template constant. `grep coverage_gap src/agents/ai-explainer/*.ts` returns zero hits — the AI Explainer agent has no code path that routes coverage_gap findings through context-aware enrichment.

### Obs 8 evidence — finding_type and evidence_strength are set deterministically at 15+ sites

Direct assignments of `finding_type: 'coverage_gap' | 'likely_issue' | 'confirmed_issue'` appear in: `src/core/orchestrator/scan-orchestrator.ts:192`, `src/agents/synthetic-data-manager/agent.ts:342, 467`, `src/agents/authz-tenant/agent.ts:66`, `src/agents/authz-tenant/predicates.ts:118, 135, 162, 219, 248`, `src/agents/tool-runner/tool-runner.ts:110`. Each is a hard-coded string literal in deterministic code. AI Inference (`src/agents/ai-inference/agent.ts:114`) only proposes via the `proposed_finding_type` field, constrained to the enum `'likely_issue' | 'informational'` — never `'confirmed_issue'`. The deterministic Pass-2 disposition (`src/core/assertions/hypothesis-disposition.ts:4`) is the *sole* emitter of any classification AI's hypothesis gets attached to.

### Obs 9 evidence — 19 customer-facing CLI options

`grep -c "^\s+\.option(" src/cli/scan-command.ts` returns **19**. The flag list (per `pnpm dev -- scan --help`) covers project / output / fail-on-blocker / mode / env / Lovable connector / Supabase connector variants / AI provider / AI tuning. None of these flags is inferred from environment or filesystem; all must be explicitly passed by the operator.

### Preventer 10 evidence — current Phase 2 default is manifest mode, by binding decision

`phases/phase-2/steps/01-lock-phase2-blocking-decisions.md:45` (verbatim): *"Manifest mode (Mode B sub-mode B.1) is the default documented Mode B path. When customers run Mode B, the documented happy-path is the manifest flow."* The reason stated in the same paragraph (line 45) makes the operator-friction trade-off explicit: *"B.1 requires no admin/service-role credentials; B.2 does, and that's a much bigger trust ask we don't want as the default story."*

### Summary of file-level evidence

The 10 Observations describe an architecture in which intelligence sits on the perimeter and determinism sits at the core. The cited files show this is not an accident of partial implementation — it is the structurally enforced design. Comments, type definitions, test names, and per-site assignments all reinforce the rule: deterministic code authors findings; AI annotates. This is the foundation an AGI-class reframe must address. The planner should treat each Observation's evidence as ground truth, not as a starting hypothesis.
