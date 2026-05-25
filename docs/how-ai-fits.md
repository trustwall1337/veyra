# How AI fits in a Veyra scan

This document describes the AI-first reshape that Phase 1 ships.
Plain language. Reading this end-to-end lets you predict which agent
writes which artifact, and where AI sits versus deterministic code.

Derived from `phases/phase-1/REVISION_AI_SHAPE.md` §1 + §3 + §7 + §8 +
§11 + §12b, and `phases/FINAL_PRODUCT_PLAN.md` §18 (non-goals).

## The seven layers

Veyra's scan runs as seven layers. AI is in three of them; the other
four are deterministic.

1. **Bootstrap Inventory** (deterministic). Walks the local project,
   reads `package.json`, detects framework markers, harvests env
   declarations, extracts route patterns. When MCP is configured,
   pulls schema metadata + bucket state. Writes
   `inventory-bootstrap.json`. Source of `observed_evidence`.

   - 1b. **AI Product-Understanding** (AI, optional). Reads the
     bootstrap inventory and writes `ai-declared-intent.json` only —
     never `observed_evidence`. Skipped when AI is not opted in.

   - 1c. **declared-context-builder** (deterministic). Sole writer of
     `declared-context.json`. Merges `inventory-bootstrap.json` +
     `ai-declared-intent.json` with field-by-owner enforcement: an
     artifact that tries to write the wrong field is rejected.

2. **Observation Layer** (deterministic). Three scanner adapters
   (gitleaks, OSV, semgrep) emit `ScanFact[]` records. Tool-runner
   aggregates them into the consolidated `scan-facts.json`. No
   classification at this layer.

3. **AI Inference Layer** (AI, optional). Reads `scan-facts.json` +
   sanitized `declared-context.json`. Produces `Hypothesis[]` — each
   citing at least one fact_id. May emit `ContextRequest`s. Never
   produces Findings. Skipped when AI is not opted in.

4. **Assertion Layer** (deterministic). Two passes:

   - Pass 1: per-control predicates over `ScanFact[]` only. Each
     predicate is a pure function with `Hypothesis` absent from its
     signature. Output: `Finding[]`.
   - Pass 2: the `disposeHypotheses()` module attaches hypotheses to
     matching findings, logs `predicate_contradicted` for shape
     mismatches, retries `ContextRequest`s, or emits `AIConcern`s.

5. **AI Security Planner** (Phase 2, deferred). Reads `findings.json`
   + the Phase 2 active-test catalog. Writes `proposed-scan-plan.json`.
   Phase 1 does not run this layer.

6. **ActiveValidationPolicyCompiler** (Phase 2, deferred,
   deterministic). Reads the AI planner's `proposed-scan-plan.json`
   plus the closed test catalog and emits a
   `compiled-validation-policy.json`. Per revision §6, this is a
   deterministic compiler: the planner can suggest from the catalog
   but cannot invent a new test or omit a mandatory baseline entry.
   Phase 1 does not run this layer.

7. **Execution Layer** (Phase 2, deferred). The sandbox runner that
   exercises the compiled plan against synthetic identities, emitting
   `proven_denial` / `proven_allowed` / `inconclusive` outcomes per
   `(control_id, variant_id)`. Some `proven_allowed` results promote
   `likely_issue` findings to `confirmed_issue` via the Phase 2
   promotion path. Phase 1 does not run this layer.

## The four artifact types

| Artifact | Producer | Consumer | One-line description |
|---|---|---|---|
| `ScanFact` | scanners, parsers, MCP connectors | AI Inference Agent, Assertion Pass-1 predicates | What we saw. Never carries classification. |
| `Hypothesis` | AI Inference Agent (08d) | Pass-2 disposition (18b) | What AI thinks about what we saw. Must cite a fact_id. |
| `Finding` | Assertion Pass-1 predicates only | reporter, evidence-report agent | A deterministic verdict. AI never sets `finding_type` etc. |
| `AIConcern` | Pass-2 disposition module only | reporter | A hypothesis no predicate fired on. Audit-only — never blocks. |

These four do not cross-pollute. The reporter renders them under
distinct headings; the assertion layer is the only producer of
Findings; the disposition module is the only producer of AIConcerns.

## Who writes which artifact (the dataflow)

```
inventory-bootstrap.json   ← 17b deterministic Bootstrap Inventory
ai-declared-intent.json    ← 17c AI Product-Understanding (optional)
declared-context.json      ← 17c declared-context-builder (composer)

scan-facts.json            ← 08b tool-runner (aggregates 05b/06b/07b)
hypotheses.json            ← 08d AI Inference Agent (optional)
context-requests.json      ← 08d AI Inference Agent (optional)

findings.json              ← 09b/10b/11b/12b Pass-1 predicates
ai-concerns.json           ← 18b Pass-2 disposition module
assertions.json            ← 18b Pass-2 (audit spine — every hypothesis)

control-cards.json         ← 14b evidence-report agent
readiness-report.json      ← 14b evidence-report agent
veyra-report.md / .json    ← 13 + 13b reporters
scan-trace.json            ← 18b orchestrator (debug-only)
```

If a future reader wants to know "who writes
`declared-context.json`?", the answer is "the deterministic composer
in 17c, after merging the inventory bootstrap and the optional AI
declared intent — with field-by-owner enforcement."

## The §12b opt-in matrix

AI is off by default. Opting in requires both an env var and a flag.

| Configuration                          | Layer 1b (AI Product) | Layer 3 (AI Inference) | Layer 5 (Phase 2) | Report has AIConcerns? |
|---|---|---|---|---|
| no env var, no flag                    | skipped | skipped | skipped | no |
| env var set, no flag                   | skipped | skipped | skipped | no |
| no env var, `--ai-provider anthropic`  | reject at parse time | — | — | scan aborts; user told to set the env var |
| env var + `--ai-provider`              | runs | runs | runs (Phase 2 only) | yes |
| env var + `--ai-provider` + `--no-ai`  | skipped (override) | skipped | skipped | no |

The deterministic baseline is the floor; AI flags add the inference
and product-understanding layers on top.

## The ten trust-model constraints

From revision §8, all binding on every future change:

1. AI never sets `finding_type`, `evidence_strength`, `review_action`,
   `blast_radius`, `readiness_status`.
2. AI never makes block / fix decisions.
3. AI never executes code, SQL, migrations, shell.
4. AI never invents new active tests at runtime.
5. AI never calls connectors or holds credentials. (Context requests
   route through 08c's `ContextPolicyEvaluator`.)
6. AI never deletes from the mandatory baseline. The compiler injects
   missing baseline entries; `--no-ai` produces the same Findings set.
7. AI output is `Hypothesis`, never `Finding`. The Assertion Layer is
   the only Finding producer.
8. AI never populates `observed_evidence`. The deterministic Bootstrap
   Inventory owns it.
9. Unasserted hypotheses become `AIConcern`, not `missing_evidence`
   Findings.
10. Baseline predicates run on facts, not on hypothesis presence. AI
    absence is not a security gap.

## The three-tier report

The Markdown report renders three distinct sections:

- **Items that appear launch-blocking** + **Findings** — deterministic
  output. The Findings tier is what `--fail-on-blocker` reads.
- **AI-suggested areas for human review** — AIConcerns at or above
  `--ai-concern-threshold` (default `medium`). Tier 2 is omitted
  entirely under `--no-ai`.
- **Active validation outcomes** — Phase 2 placeholder; Phase 1
  renders the heading with a "not run" note.

AIConcerns never appear under the Findings heading. The reporter
enforces the boundary; tier mixing is a launch-blocker for Veyra
itself.

## Non-goals (reaffirmed)

Per `PHASE_1_PLAN §6` and `FPP §18`, Phase 1 deliberately does not
ship:

- An AI chat / Q&A interface against findings.
- Autonomous remediation, auto-fix, or PR comments.
- AI replacing the scanner stack (Semgrep / Gitleaks / OSV stay).
- AI populating `observed_evidence` or `assertions.json`.
- AI in tool-runner, synthetic-data-manager, sandbox-runner, or
  evidence-report. These are deterministic safety walls.
- New active tests at runtime. The Phase 2 catalog is checked in.
- Relaxing any of the ten trust-model constraints above.
- Hosted dashboards, Slack integrations, compliance reports,
  production scanning, scheduling / queue infrastructure.

If a future phase introduces any of these, it comes with explicit
approval gates documented in `phases/`.

## Provider neutrality

The AI provider is selected via `--ai-provider <id>`. Phase 1 ships
the Anthropic adapter as the default provider; OpenAI is a Phase 2
deliverable. The `AiProvider` interface is provider-agnostic; adding a
new adapter is a `src/ai/providers/<name>/` folder plus a registry
entry — no shared-type edits.

## Where to look

- `phases/phase-1/PHASE_1_PLAN.md` — the binding Phase 1 plan.
- `phases/phase-1/REVISION_AI_SHAPE.md` — the AI-first reshape.
- `phases/phase-1/steps/` — every step file, including the `-b`
  amendments that land the post-revision shape.
- `src/agents/` — one folder per agent.
- `src/core/assertions/hypothesis-disposition.ts` — Pass-2 rules 1-5.
- `src/core/policy/context-policy-evaluator.ts` — the deterministic
  gate AI requests pass through.
