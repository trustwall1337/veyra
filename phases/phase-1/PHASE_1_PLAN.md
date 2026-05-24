# Veyra Phase 1 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Build the first local-first Veyra version: an AI-assisted security-readiness analyzer for Lovable + Supabase apps that understands the project, checks high-risk controls, and generates an evidence-backed readiness report.

**Architecture:** Phase 1 is a local-first CLI with optional connected context collection. The core scanner must work from local files and Supabase metadata exports, while the connected mode can use Lovable MCP and Supabase MCP where the user explicitly connects them.

**Tech Stack:** TypeScript/Node.js CLI, MCP client integration, local parsers, Gitleaks or compatible secret-scanning runner, OSV-Scanner or npm audit dependency runner, Markdown/JSON report output.

---

> **Alignment notes (2026-05-24).** This plan has been updated in spots to
> match decisions made during execution planning. Detailed step files live
> at `phases/phase-1/steps/`. Key alignments worth knowing before reading on:
>
> - **Validation-policy seam.** Phase 1's only implemented mode is
>   `read_only_evidence`. `sandbox_active_validation` lands in Phase 2
>   (`phases/phase-2/PHASE_2_PLAN.md`); `approved_production_safe` is a
>   later-phase capability (product-rollout placement: `FPP §17 Phase 5`).
>   The `--mode` and `--env` flags exist from day one; deferred modes reject
>   at parse time with explicit "not yet implemented" messages.
> - **AI deferred.** §3 Step 4 "AI Security Reasoning" moves to Phase 2.
>   Phase 1 ships an AI provider adapter interface only; no provider is
>   wired. See `phases/phase-2/PHASE_2_PLAN.md §10`.
> - **CLI is delivery, not product identity.** Phase 1's implementation
>   surface is a scan runner + report generator. "Local-first CLI" wording
>   elsewhere in this doc refers to the shipping mechanism, not the product.
> - **Storage bucket detection is MCP-only.** Supabase `db dump` excludes
>   managed schemas including `storage`, so bucket public/private state must
>   come from Supabase MCP `list_storage_buckets` + `get_storage_config`.
>   Schema parsing cannot find it. Without MCP, bucket findings are
>   `coverage_gap`, never silently absent.
> - **`send_message` is template-only.** Lovable MCP `send_message` accepts
>   only template IDs from a fixed allowlist (`templates.project_overview`,
>   `templates.user_flows`, `templates.data_handling`, `templates.auth_model`)
>   — not free-form text classification.
> - **`--fail-on-blocker` gates on `readiness_status: launch_blocker`**,
>   which covers both `confirmed_issue + fix_before_launch` AND
>   high-confidence `likely_issue + fix_before_launch`. Gating only on
>   `confirmed_issue` would miss Phase 1 heuristic findings by design.
> - **Canonical control catalog** lives in
>   `src/agents/evidence-report/controls.ts` (per step 14). All `control_id`
>   references resolve there.
> - **Extensibility-first architecture.** Phase 1 ships only for Lovable +
>   Supabase, but no shared code may hard-code their names. Discriminated
>   unions over connector / scanner / analyzer / database / transport
>   identities use opaque branded ID types (`ConnectorId`, `ScannerId`,
>   `AnalyzerId`, etc.) backed by a registry. Adding a new connector
>   (Firebase, Plain Postgres, GitHub, GitLab, gRPC analyzer, etc.) in a
>   future phase must be a "new folder + registry entry" operation, not a
>   refactor of shared types. Binding rules in
>   `FINAL_PRODUCT_PLAN.md §2A`. This is **not** an invitation to build
>   those connectors in Phase 1 — premature implementation remains
>   forbidden per `CLAUDE.md`. The principle is about putting the seams
>   in the right place.

---

## 1. Verified Capabilities

This plan only relies on capabilities verified from official documentation on 2026-05-24.

### Lovable MCP

Official docs confirm:

- Lovable exposes an MCP server at `https://mcp.lovable.dev`.
- The MCP server is in research preview.
- Authentication uses OAuth.
- A Pro or Business plan is required.
- Available tools include project discovery, project details, file listing, file reading, edit history, diff inspection, and sending messages to the Lovable agent.
- `send_message` supports `plan_mode`.
- The docs warn that connecting a client gives account-level access and that some tools can edit or deploy projects.

Sources:

- https://docs.lovable.dev/integrations/lovable-mcp-server
- https://docs.lovable.dev/integrations/lovable-api

Veyra Phase 1 conclusion:

- We can use Lovable MCP for project understanding and code inspection.
- We should treat Lovable's project description as context, not proof.
- We should use a strict allowlist of read/context tools.
- We should not use deploy, create, edit, database query, visibility, or mutation tools in Phase 1.
- We should not claim Lovable PAT support unless later official docs confirm it. The verified integration path is OAuth MCP.

### Lovable GitHub Sync

Official docs confirm Lovable projects can be connected/synced to GitHub for code backup, collaboration, and exporting project code.

Source:

- https://docs.lovable.dev/integrations/git-integration

Veyra Phase 1 conclusion:

- Local repository scanning is a valid baseline path.
- Users who do not want to connect Lovable MCP can export/sync code to GitHub and scan locally.

### Supabase MCP

Official docs confirm:

- Supabase provides a hosted MCP server at `https://mcp.supabase.com/mcp`.
- It can be project-scoped with `project_ref`.
- It supports `read_only=true`.
- It exposes tools such as `list_tables`, `execute_sql`, `get_logs`, `get_advisors`, `get_project_url`, `get_publishable_keys`, `list_edge_functions`, and `get_edge_function`.
- It supports browser OAuth by default.
- PAT authentication is documented for CI environments.
- Supabase explicitly recommends read-only mode, project scoping, and avoiding production data when connecting LLMs.

Source:

- https://supabase.com/docs/guides/ai-tools/mcp

Veyra Phase 1 conclusion:

- We can support Supabase MCP as an optional metadata source.
- We should require `read_only=true` and `project_ref`.
- We should prefer development/staging projects or exported metadata.
- We should not mutate databases, apply migrations, write data, or query user data in Phase 1.

### Supabase CLI Metadata Export

Official docs confirm:

- `supabase db dump -f supabase/schema.sql` can dump schema to a file.
- `supabase db dump` supports flags such as `--schema`, `--local`, `--linked`, `--db-url`, and `--file`.

Source:

- https://supabase.com/docs/reference/cli/supabase-db-dump

Veyra Phase 1 conclusion:

- We can support a no-credential metadata path using a user-provided schema dump.
- The safest Phase 1 path is: user exports schema/RLS metadata, then Veyra analyzes the file locally.

### Gitleaks

Official docs confirm:

- Gitleaks scans code, directories, git repositories, and stdin for secrets.
- It supports `git`, `dir`, and `stdin` scanning modes.
- It supports redaction with `--redact`.
- It can output JSON, CSV, JUnit, SARIF, or template reports.

Source:

- https://github.com/gitleaks/gitleaks

Veyra Phase 1 conclusion:

- We can integrate Gitleaks as an optional local tool runner for secrets.
- Veyra should require redaction and should not store raw secret values.

### OSV-Scanner

Official docs confirm:

- OSV-Scanner can scan project source and lockfiles for dependency vulnerabilities.
- `osv-scanner scan source -r /path/to/dir` recursively scans a directory.
- It finds lockfiles, SBOMs, and git directories.
- It supports call analysis for some languages.

Source:

- https://google.github.io/osv-scanner/usage/scan-source

Veyra Phase 1 conclusion:

- We can integrate OSV-Scanner as an optional dependency-vulnerability runner.
- Dependency findings should be contextualized as launch-readiness signals, not treated as proof of exploitability.

### Semgrep

Official docs confirm:

- `semgrep scan` is the recommended command for local codebase scanning without a Semgrep account.
- It can output JSON and SARIF.
- It supports custom rules and local rule testing.

Source:

- https://semgrep.dev/docs/getting-started/cli

Veyra Phase 1 conclusion:

- Semgrep should be included in Phase 1 for custom route/auth patterns.
- Frontend-only auth checks, admin route checks, and direct-object-access patterns are better expressed as Semgrep rules than as ad hoc regex checks.
- Veyra should wrap Semgrep behind a scanner adapter so rules can evolve without coupling the core report model to Semgrep internals.

### MCP SDKs

Official MCP docs confirm:

- Official SDKs exist for building MCP clients and servers.
- TypeScript and Python are Tier 1 SDKs.
- SDKs support building clients that connect to MCP servers.

Source:

- https://modelcontextprotocol.io/docs/sdk

Veyra Phase 1 conclusion:

- A TypeScript CLI can include an MCP client integration.
- MCP integration is technically viable, but should be optional because Lovable MCP is research preview and account-scoped.

---

## 2. Phase 1 Product Shape

Phase 1 should be:

> **Veyra Phase 1: a local-first, AI-assisted readiness analyzer for Lovable + Supabase apps.**

It should have two operating modes.

### Mode A: Local Scan

This mode requires no Lovable account and no live Supabase connection.

Input:

```bash
veyra scan \
  --project ./my-lovable-export \
  --supabase-schema ./supabase/schema.sql \
  --out veyra-report.md
```

Use this when:

- the user exported or synced Lovable code to GitHub
- the user has a local repo
- the user can export Supabase schema/RLS metadata
- the user does not want to connect MCP tools

### Mode B: Connected Context Scan

This mode uses optional MCP connections.

Input:

```bash
veyra scan \
  --lovable-mcp \
  --lovable-project <project_id> \
  --supabase-mcp \
  --supabase-project-ref <project_ref> \
  --out veyra-report.md
```

Use this when:

- the user has a Lovable Pro or Business account
- the user explicitly connects Lovable MCP
- the user explicitly connects Supabase MCP in read-only, project-scoped mode
- the user wants Veyra to ask Lovable for project intent before scanning

Connected mode must still produce findings only from evidence. Lovable's answers are project context, not source-of-truth.

---

## 3. First User Workflow

### Step 1: Project Understanding

Veyra asks Lovable MCP for project context when connected.

Allowed Lovable MCP tools:

- `get_project`
- `list_files`
- `read_file`
- `list_edits`
- `get_diff`
- `send_message` only with `plan_mode` and only for read-only project-description questions

Disallowed Lovable MCP tools in Phase 1:

- `create_project`
- `deploy_project`
- `remix_project`
- `set_project_visibility`
- `enable_database`
- `query_database`
- `get_database_connection_info`
- `set_workspace_knowledge`
- `set_project_knowledge`
- `add_mcp_server`
- `remove_mcp_server`
- any tool that mutates project, database, visibility, deployment, or workspace state

Questions to ask Lovable:

- What does this app do?
- What are the main user roles?
- Which routes require authentication?
- Which routes are admin-only?
- What user-owned or tenant-owned resources exist?
- What Supabase tables are used?
- Which tables likely contain sensitive, private, tenant, or user data?
- Are there teams, organizations, tenants, customers, projects, invoices, files, payments, or admin workflows?
- What file uploads or storage buckets are used?
- What are the most security-critical actions?
- What authorization assumptions did the app make?

Output:

```yaml
declared_project_context:
  app_summary: string
  roles: []
  sensitive_resources: []
  routes_requiring_auth: []
  admin_routes: []
  tenant_or_user_scoped_resources: []
  storage_usage: []
  critical_actions: []
  uncertainty_notes: []
```

Important rule:

> Declared project context is hypothesis. It must be checked against code, Supabase metadata, and tests.

### Step 2: Evidence Collection

Veyra collects local evidence from:

- repository files
- package manifests and lockfiles
- Supabase schema dump or Supabase MCP metadata
- Supabase RLS policy definitions
- Supabase storage metadata where available
- route/page files
- serverless/edge function files
- test files
- scanner outputs

Output:

```yaml
evidence_inventory:
  files_read: []
  tables_seen: []
  policies_seen: []
  storage_buckets_seen: []
  routes_seen: []
  tests_seen: []
  scanner_outputs: []
```

### Step 3: Deterministic Tool Checks

Run local tool checks where available:

- Gitleaks for secrets
- OSV-Scanner for dependency vulnerabilities
- Semgrep custom local rules for route/auth patterns

Veyra-owned deterministic checks:

- Supabase service-role key pattern in client-accessible files
- `.env` or secret-like files committed
- RLS disabled on likely sensitive tables
- RLS enabled but no policies
- broad RLS policy such as `using (true)`
- all-authenticated broad access to sensitive tables
- public sensitive storage bucket where metadata is available
- direct object lookup without obvious user/tenant filter
- frontend-only protected route patterns
- admin route without clear server-side role check
- missing negative auth/RLS tests

### Step 4: AI Security Reasoning — **deferred to Phase 2**

The original Phase 1 plan placed AI Security Reasoning here. Execution
planning moved it to Phase 2 (`phases/phase-2/PHASE_2_PLAN.md §10`) for three
reasons:

1. Phase 1's deterministic backbone (scanners + schema parser + heuristics)
   must produce a useful report without an AI provider key. Coupling AI into
   Phase 1 risks the deterministic path inheriting AI-shaped abstractions
   before we know what active validation will need.
2. AI explanations are most valuable once active-validation outcomes exist
   to explain ("the test denied the synthetic actor; here is why that matters
   for your tenant model"). Phase 1 has no such outcomes.
3. AI must never classify findings or make block/fix decisions. Holding the
   AI integration until Phase 2 keeps that boundary structurally enforced
   for Phase 1.

**Phase 1 ships only the AI provider adapter interface**, no provider wired.
The CLI exposes `--no-ai` and `--ai-provider` flags as stubs. The reporter
reserves the AI-enrichment section but renders it empty in Phase 1.

When AI lands in Phase 2, the original Phase 1 constraints remain
non-negotiable and become Phase 2 §10 rules:

- AI is optional; the deterministic path still works without a key.
- AI integration is provider-agnostic through an adapter interface.
- Prompts receive sanitized evidence only. No raw secrets, no raw user data.
- Reports distinguish deterministic findings from AI-enriched explanations.
- Cost controls include max files, max tokens, and `--no-ai`.
- AI never produces `confirmed_issue` classifications.
- AI never claims the app is secure, mutates state, queries production user
  data, creates tickets, or auto-fixes anything.

### Step 5: Report Generation

Veyra produces:

- Markdown report
- JSON report
- control cards
- readiness status
- finding list
- suggested negative tests
- remediation guidance

Readiness states:

- `blocked`
- `needs_review`
- `ready_with_notes`
- `unknown_not_enough_evidence`

---

## 4. Agent Responsibilities

Agents are first-class architecture units from day one.

In v0.1 they may execute inside one local CLI process for simplicity, but that is only a runtime packaging choice. Each agent must have a separate module, explicit input/output schema, no hidden shared mutable state, and an artifact-based interface so it can later move to:

- an isolated worker process
- a queue-driven SaaS worker
- a containerized job
- an MCP tool/server
- a separately deployable service

The design goal is:

> **Build a local-first tool now, without creating architecture debt that blocks a future hosted multi-agent platform.**

### 4.0 Agent Runtime Architecture

The Phase 1 runtime should be organized around an orchestrator and independent agents.

```text
CLI
 |
 v
Scan Orchestrator
 |
 |-- Product Understanding Agent
 |-- Tool Runner Agent
 |-- Supabase/RLS Agent
 |-- Authn Agent
 |-- Authz/Tenant Boundary Agent
 |-- Business Logic Agent
 |-- Evidence and Report Agent
 |
 v
Artifact Store
 |
 |-- declared-context.json
 |-- evidence-inventory.json
 |-- scanner-findings.json
 |-- control-cards.json
 |-- veyra-report.json
 |-- veyra-report.md
```

Agent contract:

```ts
interface VeyraAgent<I, O> {
  id: string;
  version: string;
  run(input: I, context: AgentExecutionContext): Promise<AgentResult<O>>;
}

interface AgentExecutionContext {
  scanId: string;
  projectRoot: string;
  artifactDir: string;
  permissions: AgentPermissions;
  logger: AgentLogger;
}

interface AgentResult<O> {
  status: "completed" | "skipped" | "failed";
  output?: O;
  artifacts: ArtifactRef[];
  findings: Finding[];
  warnings: string[];
}
```

Architecture rules:

- Agents communicate through typed inputs, outputs, and artifacts.
- Agents do not call each other directly.
- The orchestrator owns ordering, retries, and dependency wiring.
- Every agent must be individually testable with fixture inputs.
- Every agent output must include source/evidence references where relevant.
- Tool execution must be wrapped behind scanner adapters.
- External MCP access must be isolated behind connector modules.
- Mutation-capable tools must be blocked by policy before an agent can call them.
- The future hosted SaaS should be able to reuse the same agents without rewriting the analysis logic.

### 4.1 Product Understanding Agent

Purpose:

- Build a functional and technical map of the app.

Inputs:

- Lovable MCP `get_project`
- Lovable MCP `list_files`
- Lovable MCP `read_file`
- Lovable MCP `send_message` in `plan_mode`
- local repository files

Outputs:

- declared app purpose
- roles
- sensitive resources
- auth-required routes
- admin routes
- tenant/user-scoped resources
- business-critical actions
- uncertainty notes

Controls:

- Treat Lovable answers as declared intent, not proof.
- Do not use mutation tools.
- Do not use deployment or database mutation tools.

### 4.2 Authn Agent

Purpose:

- Determine whether authentication appears to be required and enforced for sensitive routes/actions.

Inputs:

- route files
- middleware files
- Supabase auth usage
- Lovable-declared route intent

Outputs:

- protected route map
- unprotected sensitive route findings
- frontend-only auth findings
- missing evidence findings

Controls:

- If server-side evidence is missing, classify as `missing_evidence` or `likely_issue`, not confirmed.

### 4.3 Authz and Tenant Boundary Agent

Purpose:

- Identify likely authorization and tenant-isolation gaps.

Inputs:

- route/API code
- database queries
- Supabase RLS policies
- declared roles/resources
- test files

Outputs:

- BOLA/IDOR risk findings
- tenant-boundary control cards
- missing negative test suggestions
- suspicious direct-object-access patterns

Controls:

- Confirm only when evidence is direct.
- Otherwise classify as `likely_issue`, `coverage_gap`, or `missing_evidence`.

### 4.4 Supabase/RLS Agent

Purpose:

- Analyze Supabase schema, RLS, policies, and storage metadata.

Inputs:

- schema dump (for table-level RLS, policies, grants)
- Supabase MCP read-only metadata (for storage bucket state — **bucket
  public/private state is NOT in the schema dump** because Supabase
  `db dump` excludes the `storage` schema)
- storage metadata where available

Outputs:

- RLS disabled findings
- missing policy findings
- broad policy findings
- public storage findings (only when Supabase MCP is configured; otherwise
  `coverage_gap` with the message that bucket state was not checked)
- table/resource sensitivity guesses with confidence

Controls:

- Do not query user data.
- Do not apply migrations.
- Do not change policies.
- Storage bucket detection requires Supabase MCP. Schema parsing alone
  cannot determine bucket state; emit `coverage_gap` rather than silent
  absence.

### 4.5 Business Logic Agent

Purpose:

- Identify plausible abuse cases based on project functionality.

Inputs:

- declared project context
- routes/actions
- roles
- sensitive resources

Outputs:

- business-logic review questions
- suggested negative tests
- likely abuse cases

Examples:

- non-admin updates another user's role
- user approves own refund
- tenant member invites users to another tenant
- user guesses another invoice ID
- public user downloads private document

Controls:

- Business-logic findings are never `confirmed_issue` unless backed by clear code/test evidence.

### 4.6 Tool Runner Agent

Purpose:

- Run deterministic local tools and normalize outputs.

Inputs:

- project path
- tool availability
- scanner configs

Outputs:

- normalized secrets findings
- normalized dependency findings
- optional SARIF/JSON artifacts

Controls:

- Redact secrets.
- Do not upload source code by default.
- Tool execution must be local in Phase 1.

### 4.7 Evidence and Report Agent

Purpose:

- Convert findings and control gaps into a clear readiness report.

Inputs:

- declared project context
- evidence inventory
- deterministic findings
- AI-reviewed risks
- suggested tests

Outputs:

- `veyra-report.md`
- `veyra-report.json`
- control cards
- summary readiness state

Controls:

- Every finding must include evidence or an explicit `missing_evidence` label.
- Every AI-generated statement must include confidence and uncertainty.

---

## 5. Finding Model

```yaml
finding_type:
  - confirmed_issue
  - likely_issue
  - missing_evidence
  - coverage_gap
  - informational

evidence_strength:
  - low
  - medium
  - high

reproducibility:
  - static
  - mcp_context
  - tool_output
  - manual_review_required

review_action:
  - fix_before_launch
  - review_before_launch
  - add_test
  - monitor
  - accept_with_owner

blast_radius:
  - secrets
  - user_data
  - tenant_data
  - admin_access
  - financial_data
  - private_files
  - availability
  - unknown
```

---

## 6. Phase 1 Deliverables

### Required

- CLI command: `veyra scan` (with `--mode`, `--env`, `--lovable-project`,
  `--lovable-mcp`, `--supabase-mcp`, `--no-ai`, `--ai-provider`,
  `--fail-on-blocker`)
- Validation-policy types: `ValidationMode`, `EnvironmentType`,
  `ValidationPolicy`, `AllowedAction`, `ApprovalPolicy` (Phase 1 implements
  the `read_only_evidence` branch; Phase 2/3 branches reject at parse time)
- Local project scanner
- Supabase schema/RLS parser
- Optional Lovable MCP context collector (`send_message` template-only)
- Optional Supabase MCP read-only metadata collector (read_only derived
  from policy, not hardcoded)
- Gitleaks integration with `--redact` mandatory
- OSV-Scanner or npm audit dependency adapter
- Semgrep custom-rule adapter for route/auth patterns
- Authn/authz/tenant-boundary heuristic checks
- Business-logic review-question generator (deterministic checklist; AI
  refinement moves to Phase 2)
- Canonical control catalog at `src/agents/evidence-report/controls.ts`
- Control graph primitives: `control_id -> expected_behavior ->
  evidence_refs -> findings -> suggested_tests -> readiness_status`
- `EvidenceItem` as a discriminated union of `EvidenceKind`
  (`static_code | mcp_context | scanner | active_validation |
  cleanup_proof`; Phase 1 emits the first three)
- Markdown report (per-`EvidenceKind` rendering) + JSON report
- `--fail-on-blocker` CI exit-code behavior gating on
  `readiness_status: launch_blocker`
- Example vulnerable Lovable/Supabase project fixture with expected findings
  keyed by `control_id`; includes `mcp-fixtures/` for storage-bucket data
- AI provider adapter interface only (no provider wired in Phase 1)
- Documentation for safe metadata export

### Not Required

- hosted dashboard
- GitHub App
- Slack
- Jira
- PR comments
- production scanning
- offensive testing
- autonomous remediation
- database mutation
- deployment mutation
- compliance claims
- live AI provider integration (Phase 2)
- sandbox active validation (Phase 2; see `phases/phase-2/PHASE_2_PLAN.md`)
- approved production-safe validation (later phase; product-rollout placement `FPP §17 Phase 5`)
- synthetic identity / tenant creation (Phase 2)
- cleanup proof machinery (Phase 2)
- AI-generated finding classifications (forbidden in all phases)

---

## 7. First Implementation Tasks

### Task 1: Repository Skeleton

Create:

```text
veyra/
  package.json
  README.md
  docs/
    phase-1.md
    lovable-mcp-safety.md
    supabase-metadata-export.md
  src/
    cli/
    core/
      orchestrator/
      artifacts/
      policy/
    connectors/
      lovable/
      supabase/
    agents/
      product-understanding/
      authn/
      authz-tenant/
      supabase-rls/
      business-logic/
      tool-runner/
      evidence-report/
    scanners/
      gitleaks/
      osv/
      semgrep/
    reporters/
      markdown/
      json/
    types/
  examples/
    vulnerable-lovable-supabase/
  rules/
    supabase/
    authz/
    secrets/
```

### Task 2: Agent Contracts and Artifact Store

Define stable contracts before implementing agent logic.

Create:

```text
src/types/agent.ts
src/types/artifact.ts
src/types/finding.ts
src/types/control-card.ts
src/core/artifacts/artifact-store.ts
src/core/orchestrator/scan-orchestrator.ts
src/core/policy/tool-policy.ts
```

Minimum behavior:

- define `VeyraAgent<I, O>`
- define `AgentExecutionContext`
- define `AgentResult<O>`
- define artifact references and artifact types
- write/read artifacts from a scan output directory
- enforce a tool policy before connectors or scanners run

Design rule:

> Each agent must be replaceable by a separate process or service later without changing the report model.

### Task 3: CLI

Add:

```bash
veyra scan --project ./app --supabase-schema ./schema.sql --out report.md
```

Minimum behavior:

- validate paths
- collect file inventory
- run local checks
- emit Markdown and JSON

### Task 4: Evidence Schema

Define typed objects:

- `DeclaredProjectContext`
- `EvidenceItem`
- `Finding`
- `ControlCard`
- `ReadinessReport`
- `SuggestedTest`

### Task 5: Product Understanding Agent

Implement a separate `product-understanding` agent.

Responsibilities:

- collect project description from Lovable MCP when enabled
- read local project structure when MCP is not enabled
- produce `declared-context.json`
- separate declared intent from observed evidence

### Task 6: Supabase Schema/RLS Parser and Agent

Parse schema SQL for:

- table names
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY`
- broad policy expressions
- likely sensitive table names

Wrap the parser inside the `supabase-rls` agent.

### Task 7: Lovable MCP Connector

Implement optional collector:

- connect only when user passes explicit MCP flag
- list/read project files
- ask project-description questions in `plan_mode`
- store declared intent separately from evidence

The connector must not contain security reasoning. It only collects approved context and artifacts for agents.

### Task 8: Supabase MCP Read-Only Connector

Implement optional collector:

- require `project_ref`
- require `read_only=true`
- collect table/function/policy metadata where available
- do not query user rows
- do not call write/migration tools

The connector must enforce read-only policy before every tool call.

### Task 9: Local Scanner Adapters and Tool Runner Agent

Add adapters for:

- Gitleaks with redacted output
- OSV-Scanner or npm audit
- Semgrep custom rules for route/auth patterns

Wrap scanner adapters inside the `tool-runner` agent.

### Task 10: Authn Agent

Implement initial heuristics:

- frontend-only protected route
- admin route without obvious server-side role check

### Task 11: Authz/Tenant Boundary Agent

Implement initial heuristics:

- direct object access by ID without obvious user/tenant constraint
- query uses client-provided `tenant_id`
- missing negative tests

### Task 12: Business Logic Agent

Generate review questions from app context:

- What actions change money, roles, ownership, invitations, files, or tenant membership?
- Can a user act on their own approval workflow?
- Can a user invite or modify another tenant?
- Are admin/support actions server-side enforced?

### Task 13: Evidence and Report Agent

Generate:

- executive summary
- declared project context
- observed evidence
- launch blockers
- findings
- control cards
- suggested tests
- uncertainty notes
- sources and scanner metadata

---

## 8. Success Criteria

Phase 1 is successful when:

- A user can run Veyra locally against a Lovable + Supabase-style project.
- Veyra can optionally collect Lovable context through MCP.
- Veyra can analyze Supabase schema/RLS metadata without requiring production data access.
- Secrets are redacted.
- Findings are separated into confirmed, likely, missing evidence, coverage gap, and informational.
- The vulnerable fixture triggers the expected findings for the 12 initial checks, including at least 2 intentionally seeded non-issues to test false-positive handling.
- At least 5 sample or real projects are manually reviewed.
- Every reported launch blocker is manually verified during validation.
- At least 3 of 5 manually reviewed scans surface a finding or missing-evidence gap that was not already obvious to the user.
- The report helps a developer understand what to fix or test before launch.

---

## 9. Explicit Non-Claims

Veyra Phase 1 must not claim:

- the application is secure
- authorization is fully proven
- compliance is achieved
- production is safe to scan
- AI findings are final authority
- scanner silence means no vulnerability exists

Veyra Phase 1 may claim:

- these controls were checked
- this evidence was found
- this evidence was missing
- these issues appear launch-blocking
- these areas need human review
- these negative tests should be added

---

## 10. Recommended Phase 1 Positioning

> **Veyra is a security-readiness platform for AI-built SaaS apps, starting
> with Lovable + Supabase. It asks what the app is supposed to do, checks
> whether auth, authorization, RLS, tenant isolation, secrets, storage, and
> tests support that intent, and produces an evidence-backed launch-readiness
> report. Phase 1 ships as a local-first CLI scan runner — the first delivery
> mechanism, not the product identity. Phase 2 adds sandbox active validation
> and AI-assisted explanation
> (`phases/phase-2/PHASE_2_PLAN.md`).**
