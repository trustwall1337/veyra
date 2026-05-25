# Veyra Phase 1 — overview

Veyra reads a Lovable + Supabase project, runs a fixed set of deterministic
checks, optionally invokes an AI inference layer, and produces a launch-
readiness report. This document describes what Phase 1 ships, what it does
not, and how to run it.

Derived from `phases/phase-1/PHASE_1_PLAN.md` and
`phases/FINAL_PRODUCT_PLAN.md`.

## What Phase 1 does

- **Scans a local project tree.** Walks the file map, reads `package.json`,
  detects framework markers (Vite, Next, Remix), extracts route paths from
  JSX/TSX `<Route path=...>` patterns, and harvests `import.meta.env.X` /
  `process.env.X` references.
- **Optionally reads Supabase schema metadata** via MCP under
  `read_only=true` with `project_ref`. `execute_sql` is denied even though
  it would work under read-only; schema shape comes from `list_tables` +
  `get_advisors`.
- **Optionally reads Lovable declared intent** via MCP. The connector
  enforces a six-tool allowlist (`get_project`, `list_files`, `read_file`,
  `list_edits`, `get_diff`, `send_message`). `send_message` is restricted
  to four fixed prompt templates — no free-form text.
- **Runs three external scanners** when installed: `gitleaks --redact`,
  `osv-scanner`, `semgrep`. Each scanner emits `ScanFact[]` records — not
  Findings.
- **Runs deterministic assertion predicates** over scan facts to emit
  Findings keyed by `control_id` from the canonical catalog
  (`cc-11-1..cc-11-12`).
- **Optionally invokes an AI inference layer** to produce `Hypothesis[]`
  records (never Findings, never AIConcerns). AI is opt-in; the default
  baseline runs without any AI flag or env var.
- **Composes a `ReadinessReport`** with control cards, launch blockers,
  and per-control readiness status (`launch_blocker`, `needs_review`,
  `evidence_present`).
- **Renders Markdown + JSON reports** with allowed-claims vocabulary
  only.

## What Phase 1 does not do

Per `PHASE_1_PLAN §6 "Not Required"` and `FINAL_PRODUCT_PLAN §18 "What
Not To Build First"`:

- No hosted dashboards. No Slack integration. No PR comments.
- No autonomous remediation. No auto-fix. No code edits.
- No compliance reports. No SOC2 / HIPAA / GDPR claims.
- No production scanning (Phase 3). No active validation against a
  sandbox database (Phase 2).
- No AI question / answer interface for findings.
- No AI populating `observed_evidence` (revision constraint 8).
- No AI producing Findings (revision constraint 7).
- No mutation tools on either MCP connector.

## How to run a scan

```sh
pnpm dev -- scan --project ./my-project --supabase-schema ./schema.sql
```

Common flags (full list in `scan-command.ts`):

- `--project <path>` — required; path to the Lovable project root.
- `--supabase-schema <path>` — path to the SQL dump (use
  `supabase db dump`; managed schemas including `storage` are excluded by
  Supabase CLI).
- `--out <path>` — Markdown output path (default `veyra-report.md`).
- `--json <path>` — JSON output path.
- `--mode read_only_evidence` — Phase 1 only mode (default).
- `--fail-on-blocker` — exit non-zero when any control card reads
  `launch_blocker`.
- `--lovable-mcp` + `--lovable-project <id>` — opt-in to the Lovable
  connector.
- `--supabase-mcp <project_ref>` — opt-in to the Supabase connector.

AI opt-in flags (see `docs/data-access-and-trust.md` for the trust
model):

- `--ai-provider anthropic` — opt in to AI. Requires
  `ANTHROPIC_API_KEY` in the environment. Without both, AI is skipped.
- `--no-ai` — hard override; forces AI off even when other AI flags or
  env vars are present.
- `--ai-hypothesis-budget <n>` — cap on hypotheses per scan (default
  100).
- `--ai-concern-threshold <low|medium|high>` — minimum AIConcern
  confidence to render (default `medium`).

## How to read the report

The Markdown report renders sections from `FINAL_PRODUCT_PLAN §9`:

- **Executive summary** — scan id, project name, counts of controls
  evidence-present / needs-review / appear-launch-blocking.
- **Items that appear launch-blocking** — control cards whose readiness
  status is `launch_blocker`. Each finding cites its `control_id`,
  `finding_type`, `evidence_strength`, `review_action`, and
  `blast_radius`.
- **Control cards** — one card per canonical control with status,
  findings count, and supporting evidence count.
- **Sources and scanner metadata** — which scanners ran, which were
  missing, which MCP connectors were enabled, and the resulting coverage
  gaps per `control_id`.

Vocabulary used throughout the report:

- "checked," "found," "missing," "appears launch-blocking," "needs human
  review," "negative tests should be added."

Three trust-claim words are explicitly forbidden by
`phases/phase-1/PHASE_1_PLAN.md §9` and never appear in any Veyra
report.

## Limits and known misses

- Heuristic agents emit `likely_issue`, not `confirmed_issue`. Direct
  deterministic evidence (Gitleaks rule hits) may classify
  `confirmed_issue` per `FPP §11`.
- The regex schema parser may miss complex SQL (CTEs, DO $$ blocks,
  multi-statement policies, user-defined functions, non-public schemas).
  Each unparseable block emits a `coverage_gap` Finding with
  `reproducibility: manual_review_required` — never silent.
- Static authn detection misses server-side checks delivered by SSR /
  middleware / framework conventions. Findings carry `uncertainty_notes`.
- The Lovable PAT is not supported in Phase 1. The connector requires
  OAuth.
- Storage bucket state is read only through Supabase MCP. Without
  `--supabase-mcp`, cc-11-12 surfaces as `coverage_gap`, not silent
  absence.

## Related docs

- `docs/lovable-mcp-safety.md` — the Lovable MCP allowlist and fixed
  prompt templates.
- `docs/supabase-metadata-export.md` — what Supabase metadata Veyra
  reads, and how to export `schema.sql` if you prefer not to use MCP.
- `docs/data-access-and-trust.md` — the trust model in plain language.
