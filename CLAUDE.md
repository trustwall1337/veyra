# Veyra

Veyra is a security-readiness product for AI-built SaaS applications, starting
with **Lovable + Supabase** apps. It analyzes application code, Supabase
metadata, and security evidence to produce an evidence-backed launch-readiness
report.

It is **not** a vulnerability scanner, AI pentester, or compliance tool. It is a
**control-evidence graph**: which security controls should exist, where they are
implemented, and what evidence supports them.

- Full product vision: [`phases/FINAL_PRODUCT_PLAN.md`](./phases/FINAL_PRODUCT_PLAN.md)
- Current phase tasks and constraints: [`phases/phase-1/PHASE_1_PLAN.md`](./phases/phase-1/PHASE_1_PLAN.md)
- Step-by-step execution breakdown: [`phases/phase-1/steps/`](./phases/phase-1/steps/)

These documents are planning materials, not product-facing deliverables. They
are tracked in this repo so contributors can see the constraints behind each
change, but they describe intent and process — not shipped behavior.

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

## Extensibility-first architecture (load-bearing)

Veyra is **not** a Lovable+Supabase tool. It is a control-evidence platform
whose first analyzer happens to target Lovable + Supabase apps. The
binding rules below ensure tomorrow's connectors (Firebase, GitHub,
GitLab, gRPC, Clerk, S3, Terraform, MCP-security, etc.) drop in as new
folders, not as core-type refactors. Full rationale at
`phases/FINAL_PRODUCT_PLAN.md §2A`.

- **No hardcoded provider names in shared types.** Discriminated unions
  that name `'lovable' | 'supabase'` or `'gitleaks' | 'osv' | 'semgrep'`
  in `src/types/` or `src/core/` are forbidden. Use opaque branded ID
  types: `ConnectorId`, `ScannerId`, `AnalyzerId`, `DatabaseId`,
  `TransportId`. The compiler must not learn the universe of services.
- **One folder per service.** Adding a new connector / scanner / analyzer
  / database / transport = create folder + register id + implement
  contract. No edits to a central `switch (service_id)` block.
- **Policy is parameterized by service identity.** `src/core/policy/tool-policy.ts`
  looks up per-service allowlists from a registry. No
  `if (service === 'lovable')` branches in shared code.
- **Reporters are per-`EvidenceKind`, not per-provider.** Renderers
  register themselves by evidence-source discriminator. Adding a new
  connector does not require editing any reporter.
- **Control catalog is extensible.** New `control_id`s land in
  `src/agents/evidence-report/controls.ts` without changing the report
  shape. Controls may declare which analyzer/connector/scanner ids they
  consume — by id, not by switch.
- **The seams are the deliverable in early phases — not the implementations.**
  This is NOT a license to build connectors Phase 1 doesn't need. Premature
  implementation remains forbidden ("Don't add features … beyond what the
  task requires"). The principle is: put the seam in the right place,
  then ship only the narrow case the current phase calls for.

If you find yourself writing `if (connector === 'lovable')` or
`type Scanner = 'gitleaks' | 'osv' | 'semgrep'` in shared code, that is
the architectural drift this section forbids. Move the special case into
the service's own folder; expose only opaque ids to the core.

## Commands

These are the canonical script names. When adding scripts to `package.json`,
match these names exactly.

- `pnpm install` — install dependencies
- `pnpm build` — compile TypeScript to `dist/`
- `pnpm dev` — run CLI in dev. Currently a stub that prints a not-implemented banner; will accept `-- scan --project <path>` once the orchestrator and argv parser land (PHASE_1_PLAN §7 Task 3)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `pnpm test` — Vitest
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

### Validation policy (the model that replaces `read_only=true/false`)

Veyra does not gate behavior with a binary read-only flag. From step 02 of
Phase 1 onward, every scan carries a `ValidationPolicy` with three possible
modes:

- `read_only_evidence` — Phase 1's only implemented mode. Safe for any
  environment. Reads code, schema metadata, storage metadata via MCP, scanner
  outputs. Never mutates.
- `sandbox_active_validation` — Phase 2 target. Synthetic identities and data;
  controlled negative tests; mandatory cleanup. Only allowed in
  `local | dev | preview | staging | sandbox` environments.
- `approved_production_safe` — Phase 3 target. Strict scope, explicit human
  approval, rate-limited, no exploitation.

**Capability gates check `policy.allowed_actions.has('<action>')`, never
`policy.mode === '...'`.** The mode is metadata; the capability set is the
authority. There is no `read_only=true/false` toggle that, if flipped wrong,
enables mutation.

### MCP discipline

- **Lovable MCP allowlist** (Phase 1, all others forbidden):
  `get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`,
  `send_message` (only with `plan_mode`, only via fixed prompt templates from
  `src/connectors/lovable/prompt-templates.ts` — no free-form text).
  Lovable's live tool surface has grown beyond this list (e.g. `get_me`,
  `list_workspaces`, `list_projects`, `get_project_knowledge`,
  `list_mcp_servers`, `get_project_analytics`, `deploy_edge_function`).
  Allowlist-only design auto-denies them. Do not promote any new tool to the
  allowlist without an explicit Phase 2 decision.
- **Supabase MCP**, under the `read_only_evidence` policy, must always pass
  `read_only=true` AND a `project_ref`. The `read_only` flag is derived from
  the validation policy, not hardcoded in the connector. Future modes may
  relax this only with explicit approval — Phase 1 does not.
  Enforce in `src/core/policy/` before every tool call — not just at startup.
  Never call a Supabase MCP tool that mutates data, runs migrations, or
  queries user rows.
- **Supabase storage bucket state** is not in `schema.sql` (Supabase `db dump`
  excludes managed schemas including `storage`). Bucket public/private state
  comes from MCP (`list_storage_buckets` + `get_storage_config`) only. Without
  MCP, bucket findings are `coverage_gap`, not silent absence.
- **`execute_sql` is denied in Phase 1** even under `read_only=true`. Per
  `PHASE_1_PLAN.md` §4.4: do not query user data. Read schema shape via
  `list_tables` + `get_advisors` instead.

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

## Resolved engineering decisions (Phase 1, 2026-05-24)

These were open in earlier drafts. They are settled. Do not relitigate inside a
task; surface a proposal at the phase-planning level if a future phase needs to
reopen one.

- **Test framework: Vitest.** Already pinned in `package.json` (`vitest@4.1.7`).
  Runner-up: `node:test` — rejected because agent contract tests rely on
  snapshots and `vi.mock`.
- **CLI argv library: commander.** Mature, TS-native, zero deps. Pinned to
  `commander@14.0.3` (step 01 install). The earlier draft of this decision
  referenced v13 generics; v14 was current stable at install time and was
  accepted as an override — no functional change for argv parsing.
  Runner-up: `citty` — rejected because for a security CLI, maturity beats
  novelty.
- **MCP client library: `@modelcontextprotocol/sdk` (official).** Requires
  `zod` peer dep; known ESM resolution issue (#460) may need a
  `moduleResolution` workaround. If the SDK breaks at integration time, fall
  back to hand-rolled JSON-RPC over `fetch` — fallback is contained to
  `src/connectors/{lovable,supabase}/client.ts`.
- **Semgrep rules: YAML rules + `semgrep --test`.** No LLM-verified workflows
  in Phase 1; deterministic findings are required by §5 / §9.
- **Supabase schema parser: regex/line-based.** No `pgsql-parser` (libpg_query
  Wasm) dep — fixture surface is controlled and the dep is heavy. Mark this as
  a known limitation in the supabase-rls agent's `uncertainty_notes`.
- **AI provider integration: interface only in Phase 1.** Adapter type lands;
  no provider SDK imported. CLI exposes `--no-ai` / `--ai-provider` stubs only.

Phase 1 step files in `phases/phase-1/steps/` reference these decisions; the
step 01 record is the canonical source if any of these need to change.

## Working with Claude on this project

- This sits at the intersection of **security tooling** and **AI integration**.
  Both demand caution.
- Prefer evidence-based findings over heuristics. Mark heuristic findings as
  `"likely"`, never `"confirmed"`.
- When uncertain about a security boundary or scope question, ask before
  implementing.
- The product helps users, it does not replace human security review. Output
  language must reflect that everywhere — code comments, errors, reports, docs.
