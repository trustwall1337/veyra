# Veyra trust model — in plain language

Derived from `FINAL_PRODUCT_PLAN.md §8` (trust documentation) and §18
(non-goals).

This document describes what Veyra reads, what it writes, what it
claims, what it does not claim, and where the responsibility line sits.

## What Veyra reads

- The local project directory you pass via `--project`.
- The `schema.sql` file you pass via `--supabase-schema`, if any.
- The Supabase MCP server you opt into via `--supabase-mcp
  <project_ref>`, if any. Read-only metadata only.
- The Lovable MCP server you opt into via `--lovable-mcp
  --lovable-project <id>`, if any. Read-only declared intent and file
  inventory only.
- The output of three external scanners (`gitleaks --redact`,
  `osv-scanner`, `semgrep`) when they are installed.

## What Veyra writes

- The artifact directory under `<project>/.veyra/scans/<scan-id>/`:
  `inventory-bootstrap.json`, `declared-context.json`, optionally
  `ai-declared-intent.json`, `scan-facts.json`, `supabase-tables.json`,
  `storage-buckets.json`, `hypotheses.json`, `context-requests.json`,
  `control-cards.json`, `readiness-report.json`.
- The Markdown / JSON reports at the paths you pass via `--out` /
  `--json`.

That is the complete write surface. Veyra never modifies project
files, schema, Supabase tables, Lovable workspace state, or anything
else.

## What Veyra claims

The report uses exactly this vocabulary:

- "checked" — Veyra ran a deterministic predicate against observed
  evidence.
- "found" — observed evidence matched a known pattern.
- "missing" — the predicate ran but the supporting evidence was not
  present.
- "appears launch-blocking" — heuristic classification reached a level
  that justifies human review before launch.
- "needs human review" — the deterministic baseline cannot decide
  alone.
- "negative tests should be added" — the predicate flagged a coverage
  gap.

## What Veyra does not claim

The §9 trust-model rule forbids three trust-claim words about the
scanned application. The Veyra report does not assert any of those
claims about a scanned project, anywhere. See
`phases/phase-1/PHASE_1_PLAN.md §9` for the explicit list.

Beyond that vocabulary boundary:

- Not a vulnerability scanner.
- Not a pentester.
- Not a code reviewer that catches every issue.

Heuristic findings are `likely_issue`, never `confirmed_issue`, unless
the evidence is direct and deterministic (e.g. a Gitleaks rule
matched).

## AI usage (when opted in)

When you opt into AI via `--ai-provider anthropic` plus
`ANTHROPIC_API_KEY`:

- AI produces `Hypothesis` records. AI never produces Findings.
- Every hypothesis carries `confidence` (`low | medium | high`) and
  `uncertainty_notes`.
- The assertion layer decides whether a hypothesis is corroborated by
  a deterministic predicate (becomes evidence on a Finding) or stands
  alone (becomes an `AIConcern` rendered under "AI-suggested areas for
  human review" — never mixed with Findings).
- AI never holds credentials. The Lovable / Supabase connectors are
  invoked by the deterministic ContextPolicyEvaluator, never by AI
  directly.
- AI never writes to `observed_evidence`. The deterministic Bootstrap
  Inventory owns that field.
- `--no-ai` is a hard override. With it set, the scan runs without
  invoking any AI provider even when the env var and `--ai-provider`
  are both present.

## Where the responsibility line sits

Veyra helps you. Veyra does not replace human security review.

A finding labelled `appears launch-blocking` is Veyra's heuristic
judgment that a human should look before shipping. Confirming or
dismissing that judgment is your call — Veyra does not have the
context to make a final security decision for your team.

Negative tests Veyra suggests are starting points, not exhaustive
coverage. The set is what the deterministic checklist covers; your
threat model may need more.

## Non-goals (explicit)

Per `FPP §18` and `PHASE_1_PLAN §6`, Veyra deliberately does not ship:

- Hosted dashboards.
- Slack / Discord integrations.
- PR comments / GitHub bot.
- Auto-fix / autonomous remediation.
- Compliance reports (SOC2 / HIPAA / GDPR).
- Production scanning (gated to Phase 3 with explicit approval).
- Active validation against a real database (Phase 2 only, under
  sandbox).
- An AI chat interface against findings.

If a future phase introduces any of these, it will come with explicit
approval gates documented in `phases/`.
