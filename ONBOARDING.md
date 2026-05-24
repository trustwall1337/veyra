# Working on Veyra

Veyra is a security-readiness product for AI-built SaaS apps. This guide gets
you from clone to first local development task.

## What Veyra is (and isn't)

Veyra is a **control-evidence graph**: it checks whether expected security
controls have implementation evidence in a repository and produces a readiness
report. It is **not** a vulnerability scanner, an AI pentester, or a compliance
tool.

That distinction is load-bearing — it shapes the code, comments, error
messages, and reports. See [CLAUDE.md §Hard rules](./CLAUDE.md#hard-rules-non-negotiable)
for the trust-model boundaries. They are non-negotiable.

## Prerequisites

- Node.js 22 LTS (see [.nvmrc](./.nvmrc))
- pnpm 10.13.1 (pinned via `packageManager` in `package.json`)

## Setup

```bash
pnpm install
pnpm check    # typecheck + lint + test — should pass on a fresh clone
```

## Project layout

See [README.md §Project layout](./README.md#project-layout) for the directory
map. The product is organized as an orchestrator that runs **agents**, which
call **connectors** and **scanners**. Agents communicate only through an
artifact store — never by direct calls. New work should fit this shape.

## How to find what to work on

- File an issue describing your proposal first if it goes beyond Phase 1's
  "Required" list.
- Phase plans live under `phases/` (gitignored — internal contributors only).
  Ask a maintainer if you need access to the current phase plan.

## Conventions

- TypeScript strict mode; no `any`, no `!` non-null assertions
- Use `Result<T, E>` (in `src/types/result.ts`) for expected failure paths;
  throw only for unexpected failures
- File naming: `kebab-case.ts`
- One primary exported entity per file; `index.ts` files only re-export
- Tests next to source as `*.test.ts`
- Import order: node built-ins → external packages → internal absolute →
  relative, with blank lines between groups
- Errors are `Error` subclasses with descriptive names (e.g.
  `PolicyViolationError`, `RedactionError`)

## Running Veyra

```bash
pnpm dev       # currently prints a stub banner — the orchestrator lands in
               # Phase 1 Task 3
pnpm build     # compile TypeScript to ./dist
```

## Trust-model rules (read once, internalize)

These are launch-blockers for Veyra itself, not style preferences:

1. **Output language** — never claim a scanned app is "secure," "safe," or
   "compliant." Use the allowed claims listed in CLAUDE.md.
2. **Secrets** — never store, log, or report raw secret values. Gitleaks runs
   with `--redact`.
3. **MCP discipline** — Lovable uses a strict tool allowlist; Supabase MCP
   requires `read_only=true` and `project_ref` on every call, enforced in
   `src/core/policy/`.
4. **Scope** — Phase 1 does not include hosted dashboards, Slack, PR comments,
   autonomous remediation, or compliance claims. Stop and ask before adding
   any of these.

Full text and reasoning: [CLAUDE.md §Hard rules](./CLAUDE.md#hard-rules-non-negotiable).

## Working with Claude Code

This repo ships Claude Code configuration under `.claude/`:

- **Permission allowlist** in `.claude/settings.json` — common safe commands
  (`pnpm check`, `git status`, etc.) are pre-approved.
- **Trust-model hooks** — `PreToolUse` blocks Write/Edit calls that embed
  raw-looking secrets; `UserPromptSubmit` re-injects the trust-model rules on
  every prompt so they survive context compaction.
- **Sub-agents** under `.claude/agents/`:
  - `plan-adherence` — checks a diff against the current phase plan
  - `output-language-lint` — scans user-facing strings for trust-model
    violations
  - `mcp-policy-check` — verifies Lovable allowlist and Supabase read-only
    rules at every call site
- **Slash commands** under `.claude/commands/`:
  - `/scan-fixture` — run the CLI against the vulnerable fixture and check
    expected findings
  - `/new-agent <name>` — scaffold an agent following the §4.0 contract
  - `/check-trust-model` — run the output-language linter across the repo

Suggested workflow:

- Run `/check-trust-model` before any PR that touches user-facing strings.
- Run `/scan-fixture` before any PR that touches agents or scanners.
- Use the `plan-adherence` sub-agent if you're unsure whether a change is in
  scope for the current phase.

## Reporting issues

Use the issue tracker configured for the project. For security-sensitive
findings, contact a maintainer privately (mechanism TBD before broader launch).

## License

License decision pending.
