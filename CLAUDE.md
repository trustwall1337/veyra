# Veyra

Veyra is a security-readiness product for AI-built SaaS applications, starting
with **Lovable + Supabase** apps. It analyzes application code, Supabase
metadata, and security evidence to produce an evidence-backed launch-readiness
report.

It is **not** a vulnerability scanner, AI pentester, or compliance tool. It is a
**control-evidence graph**: which security controls should exist, where they are
implemented, and what evidence supports them.

- Full product vision: [`phases/FINAL_PRODUCT_PLAN.md`](./phases/FINAL_PRODUCT_PLAN.md) *(internal)*
- Current phase tasks and constraints: [`phases/phase-1/PHASE_1_PLAN.md`](./phases/phase-1/PHASE_1_PLAN.md) *(internal)*

> **Internal-only context.** The `phases/` directory is gitignored on purpose.
> These documents are planning materials, not product-facing deliverables.
> If you are working from a copy where these links are unavailable, ask a
> maintainer for the planning context.

Always read the relevant phase plan before starting a task that's listed there.

## Before changing…

- An agent under `src/agents/<name>/`: read `phases/phase-1/PHASE_1_PLAN.md` §4.<N> for that agent's contract and controls
- A connector under `src/connectors/<name>/`: read §1 (verified capabilities) for that service before adding any tool call
- A scanner under `src/scanners/<name>/`: read §3 (deterministic tool checks) for the allowed scope
- The report format or output language: read §5 (finding model) and §9 (explicit non-claims)
- Anything under `src/core/`: read §4.0 (agent runtime architecture)
- The CLI surface: read §2 (operating modes) and §7 Task 3 for the canonical argv shape

## Stack

- **Language:** TypeScript (strict mode, ESM)
- **Runtime:** Node.js 22 LTS
- **Package manager:** pnpm
- **Module system:** ESM only (`"type": "module"` in `package.json`)

## Architecture

The CLI is an orchestrator that runs **agents**, which call **connectors** and
**scanners**. Each agent is independently replaceable; agents communicate only
through the artifact store, never by direct calls.

```
src/
  cli/              # argv parsing, command entry points
  core/
    orchestrator/   # runs agents in sequence, manages artifacts
    artifacts/      # typed artifact store (read/write to scan output dir)
    policy/         # tool-policy enforcement (allow/deny lists)
  agents/           # one folder per agent
    product-understanding/
    authn/
    authz-tenant/
    supabase-rls/
    business-logic/
    tool-runner/
    evidence-report/
  connectors/       # optional external context sources
    lovable/
    supabase/
  scanners/         # wrappers around external tools
    gitleaks/
    osv/
    semgrep/
  reporters/        # output generators
    markdown/
    json/
  types/            # shared TypeScript types
rules/              # Semgrep custom rules
examples/
  vulnerable-lovable-supabase/   # fixture project for tests
```

## Commands

These are the canonical script names. When adding scripts to `package.json`,
match these names exactly.

- `pnpm install` — install dependencies
- `pnpm build` — compile TypeScript to `dist/`
- `pnpm dev` — run CLI in dev. Currently a stub that prints a not-implemented banner; will accept `-- scan --project <path>` once the orchestrator and argv parser land (PHASE_1_PLAN §7 Task 3)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `pnpm test` — Vitest (TBD — confirm before first test)
- `pnpm check` — runs typecheck + lint + test

## Hard rules (non-negotiable)

These come from the product's trust model. Violating any of them is a
launch-blocker for Veyra itself, not just a stylistic issue.

### Output language

- Never claim the scanned app is "secure," "safe," or "compliant."
- Use exactly this language: "these controls were checked," "this evidence was
  found," "this evidence was missing," "these issues appear launch-blocking,"
  "these areas need human review."
- See `phases/phase-1/PHASE_1_PLAN.md` §9 for the full allowed-claims list.

### Secrets

- Never store, log, or report raw secret values.
- Gitleaks must always run with `--redact`.
- Any code path that touches a potential secret must redact before persisting.

### MCP discipline

- **Lovable MCP allowlist** (Phase 1, all others forbidden):
  `get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`,
  `send_message` (only with `plan_mode`, only for read-only questions).
- **Supabase MCP** must always pass `read_only=true` AND a `project_ref`.
  Enforce this in `src/core/policy/` before every tool call — not just at
  startup. Never call a Supabase MCP tool that mutates data, runs migrations,
  or queries user rows.

### Scope discipline

The "Not Required" list in `phases/phase-1/PHASE_1_PLAN.md` §6 and "What Not To Build
First" in `FINAL_PRODUCT_PLAN.md` §18 are binding for Phase 1. If a task would
add a hosted dashboard, Slack, PR comments, autonomous remediation, compliance
claims, or anything else on those lists — **stop and ask before proceeding.**

## TypeScript conventions

- `tsconfig.json` uses `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`.
- No `any`. Use `unknown` and narrow with type guards.
- No non-null assertions (`!`). Handle `undefined` explicitly.
- Errors thrown must be `Error` subclasses with descriptive names
  (e.g. `PolicyViolationError`, `RedactionError`).
- For expected failure paths, return a `Result<T, E>` (defined in
  `src/types/result.ts`). Reserve `throw` for unexpected failures.
- Public functions and exported types get TSDoc comments.

## File and code conventions

- File naming: `kebab-case.ts`.
- One primary exported entity per file when reasonable; `index.ts` files only
  re-export.
- Tests live next to source as `*.test.ts`.
- Import order: node built-ins → external packages → internal absolute → relative,
  with blank lines between groups.

## Currently undecided (decide before implementing)

- Test framework: Vitest vs `node:test`.
- MCP client library: try official `@modelcontextprotocol/sdk` first.
- CLI argv library: commander vs citty vs yargs.

When one of these comes up, surface the decision to the user before scaffolding.

## Working with Claude on this project

- This sits at the intersection of **security tooling** and **AI integration**.
  Both demand caution.
- Prefer evidence-based findings over heuristics. Mark heuristic findings as
  `"likely"`, never `"confirmed"`.
- When uncertain about a security boundary or scope question, ask before
  implementing.
- The product helps users, it does not replace human security review. Output
  language must reflect that everywhere — code comments, errors, reports, docs.
