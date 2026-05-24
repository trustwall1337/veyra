# Veyra — Product Goal, Phases, and Execution Plan

> **Alignment notes (2026-05-24).** This document is the long-form product
> vision. Several sections have been updated to match decisions made during
> execution planning for Phase 1 + Phase 2. Where the two diverge, the
> phase-specific plans take precedence:
>
> - `phases/phase-1/PHASE_1_PLAN.md` for Phase 1 execution constraints.
> - `phases/phase-2/PHASE_2_PLAN.md` for sandbox active validation and AI.
>
> Specific alignment points worth flagging:
>
> - **§10 Finding Model.** The `reproducibility` and `blast_radius` enums
>   here have been updated to match the canonical Phase 1 `§5` enums. Earlier
>   drafts used `dynamic` and `compliance_evidence`; those values are out.
> - **§12 AI Responsibilities.** AI is plumbed in Phase 1 but lands in
>   Phase 2 (`phases/phase-2/PHASE_2_PLAN.md §10`). Phase 1 ships only the
>   provider adapter interface.
> - **§17 Phase Roadmap.** Phase 2's signature capability is sandbox active
>   validation + AI explanations. The existing Phase 2 tactical items
>   (onboarding, GitHub Action, scan history) ship alongside.
> - **§23 Differentiation.** Adds active validation as a non-scanner moat.

---

## 1. Executive Summary

**Veyra** is a focused security-readiness platform for **AI-built and fast-moving SaaS applications**.

The first target stack is:

> **Lovable + Supabase apps**

The platform helps teams answer one critical question before going to production:

> **Are the core security controls actually present, working, testable, and evidenced?**

For founders and agencies, that also translates into a simpler launch question:

> **Is this AI-built SaaS app safe enough to expose to real users?**

The first version focuses on high-risk, high-confidence security gaps common in fast-built apps:

- missing authentication
- frontend-only access checks
- weak authorization
- broken tenant isolation
- insecure Supabase Row Level Security policies
- public Supabase storage buckets
- exposed secrets and service-role keys
- vulnerable dependencies
- missing negative authorization tests
- missing launch-readiness evidence

The long-term vision is broader:

> **A continuous product-security control assurance platform that maps code, APIs, authorization, runtime signals, ownership, tests, and evidence into a control graph.**

The first product must be narrow, useful, easy to adopt, and credible for security-conscious users. It should start as a **local-first CLI**, with optional connected context through Lovable MCP and Supabase MCP only when the user explicitly enables it.

---

## 2. Final Product Direction

### Product name

# Veyra

### Tagline

> **Security readiness for AI-built SaaS apps.**

### First market wedge

> **Lovable + Supabase projects preparing for production.**

### Broader technical scope

Veyra should not be defined only by Lovable or Supabase. It should be a security-readiness platform for AI-built and fast-moving SaaS products.

The first analyzer should be designed around:

- Supabase-backed applications
- React / Next.js / Vite-style apps
- generated frontend/backend patterns
- serverless and edge functions
- GitHub repositories
- Supabase schema, RLS, storage, and auth patterns
- API and route-level authorization evidence

This allows future expansion to apps generated or built with:

- Cursor
- Claude Code
- Replit
- v0
- Copilot
- Bolt
- hand-written Supabase apps
- AI-assisted SaaS prototypes

---

## 2A. Extensibility-First Architecture (load-bearing principle)

**Veyra is not a Lovable+Supabase tool.** It is a control-evidence platform
whose first analyzer happens to target Lovable + Supabase apps. Phase 1's
choices about which connectors, scanners, languages, databases, identity
providers, and API protocols to support are **ordering decisions, not
architectural ones**.

### Expansion surface (illustrative, not a roadmap)

The architecture must allow any of these to be added as a new folder + a
registry entry, without rewriting core types or orchestrator code:

- **Code providers.** Git on any host (GitHub, GitLab, Bitbucket, Gitea,
  Azure DevOps, etc.), local filesystem, AI builders (Lovable in Phase 1,
  plus Cursor, Replit, v0, Bolt, Copilot Workspace, Claude Code), other
  VCS (Mercurial, Fossil).
- **Databases.** Supabase (Phase 1), plain Postgres on any host, MySQL,
  MariaDB, MongoDB, DynamoDB, Cassandra, Firebase Firestore, PlanetScale,
  Neon, Turso, CockroachDB, Aurora. ORMs (Prisma, Drizzle, TypeORM,
  Sequelize, ActiveRecord, SQLAlchemy).
- **APIs / transport.** REST/HTTP (Phase 1 via static analysis), GraphQL
  (schema introspection + resolver analysis), gRPC (`.proto` + service
  authz), WebSocket / SSE (handshake + message-level authz), tRPC, async
  message buses (Kafka, NATS, RabbitMQ — topic-level authz).
- **Identity providers.** Supabase Auth (Phase 1), Clerk, Auth0, Cognito,
  Firebase Auth, NextAuth, Okta, Keycloak, workspace SSO (SAML/OIDC).
- **Storage layers.** Supabase Storage (Phase 1), S3, R2, GCS, Azure Blob,
  MinIO.
- **IaC and configuration.** Terraform, Pulumi, CloudFormation, CDK,
  Crossplane; Kubernetes manifests and Helm charts (later phases).
- **AI / MCP security.** MCP-server tool-allowlist analysis (who can call
  what), AI provider call patterns (who can prompt what), prompt-injection
  surface analysis, output-handling discipline, agent framework registries
  and approval flows.
- **CI/CD evidence.** GitHub Actions, GitLab CI, Buildkite, CircleCI,
  Drone, Jenkins; build provenance, SBOMs, signed releases.
- **Scanners.** Gitleaks, OSV-Scanner, Semgrep (Phase 1), plus Trivy,
  Grype, Trufflehog, Bearer, CodeQL — or any tool with JSON output.

This list is **not a roadmap**. It is the set of expansions the architecture
must accommodate. Which of these actually land, and in what order, is a
separate business question.

### Architectural rules (binding for every phase)

1. **No hardcoded provider names in shared types.** Discriminated unions
   that name `'lovable' | 'supabase'` or `'gitleaks' | 'osv' | 'semgrep'`
   in `src/types/` or `src/core/` are forbidden. Use opaque branded ID
   types (`ConnectorId`, `ScannerId`, `AnalyzerId`, `AnalyzerLanguageId`,
   `DatabaseId`, `TransportId`) backed by a registry.
2. **One folder per service, no central switch statements.** Adding a new
   connector / scanner / analyzer / database / transport is "create folder,
   register id, implement contract." No edits to a central
   `switch (service_id)` block in shared code.
3. **Policy is parameterized by service identity.** `tool-policy.ts` reads
   per-service allowlists from a registry — no `if (service === 'lovable')`
   branches in shared code.
4. **Evidence kinds are extensible.** `EvidenceKind` is a discriminated
   union over `source`, but the inner fields (`server`, `scanner`,
   `analyzer`) are opaque IDs, not closed enums.
5. **Control catalog is extensible.** New `control_id`s land in
   `src/agents/evidence-report/controls.ts` without changing the report
   shape. Controls can declare which analyzer / connector / scanner ids
   they consume.
6. **Reporters are per-format, not per-provider.** Renderers register
   themselves by `EvidenceKind`, not by knowing every connector name.
   Adding a new connector does not require editing any reporter.
7. **Agents are pluggable.** Adding a new agent (e.g. a `graphql-authz`
   agent or a `kafka-acl` agent) is a new folder + a registry entry. No
   shared code lists the agents by name.

### What this principle does NOT require

Phase 1 ships only Lovable + Supabase. Premature implementation of any
other expansion is still forbidden, per `CLAUDE.md` "Don't design for
hypothetical future requirements." **The seams must be in the right place;
the implementations stay narrow.**

If you find yourself writing `if (connector === 'lovable')` or
`type Scanner = 'gitleaks' | 'osv' | 'semgrep'` or
`type DatabaseDialect = 'postgres' | 'mysql'` in shared code, that is the
architectural drift this section forbids. Move the special case into the
service's own folder; expose only opaque ids to the core.

---

## 3. Problem Statement and Product Vision

AI-assisted development tools such as Lovable, Cursor, Copilot, Claude Code, Replit, v0, Bolt, and similar platforms allow teams to build software extremely quickly.

This creates a new security gap.

Security design often does not move at the same speed.

Fast-moving teams may accidentally ship applications with:

- authentication only implemented in the frontend
- backend routes with no server-side authorization
- Supabase RLS disabled
- overly broad RLS policies
- public storage buckets
- leaked service-role keys
- missing tenant isolation
- unsafe direct object access
- missing audit/security logs
- no negative authorization tests
- no evidence that important controls work

Traditional AppSec tools are useful, but they often produce generic scanner findings. They do not clearly answer:

- What security control should exist?
- Where is the control implemented?
- Is it tested?
- Is it monitored?
- Is there evidence?
- Who owns it?
- What is the business risk if it fails?

### Short-term vision

Build a security-readiness assistant for AI-generated and fast-moving SaaS apps, starting with Lovable + Supabase.

It should help founders, developers, agencies, and small teams understand whether their app is ready to be exposed to real users.

### Long-term vision

Build a product-security control assurance platform.

The future platform should continuously validate important product-security controls across:

- source code
- API routes
- authorization logic
- database policies
- identity events
- runtime logs
- cloud/security signals
- CI/CD evidence
- ownership metadata
- security tests
- compliance/audit artifacts

The platform should not replace security experts. It should make security review faster, more evidence-based, and easier for product teams to act on.

---

## 4. Core Product Principle and Promise

Veyra should not be positioned as:

> Generic AI AppSec platform

or:

> AI pentester

or:

> Scanner dashboard

The core product should be:

> **A control-evidence graph that proves whether important security controls exist, where they are implemented, and what evidence supports them.**

Example control:

> **A tenant user must not be able to read another tenant's invoices.**

Veyra should connect that control to:

- database table
- Supabase RLS policy
- backend/API route
- frontend access pattern
- negative authorization test
- logs or audit evidence
- owner
- risk level
- remediation recommendation

This is what makes the product serious.

The product promise should be:

> **Veyra checks whether your AI-built SaaS app has the core security controls needed before launch: auth, authorization, tenant isolation, secrets, storage, and security tests.**

For the first product wedge, this is implemented deeply for Supabase-backed apps, including RLS, storage buckets, service-role key exposure, and Supabase-specific tenant-isolation evidence.

The first user should feel:

> **This found launch-blocking security issues in my app and explained what to fix.**

---

## 5. Strategic Decision

After comparing the different recommendations, the final strategy is:

| Topic | Final Decision |
|---|---|
| Product type | Local-first CLI first |
| Trust model | Local-first analysis, no source upload by default, optional read-only MCP context |
| First technical anchor | Supabase-backed apps |
| First marketing wedge | Lovable users |
| First user | Founder, agency, technical lead, small SaaS team |
| First value | Launch security readiness |
| First output | CLI-generated Markdown/JSON readiness report |
| First checks | 10–12 high-confidence launch blockers |
| AI role | Optional explanation, mapping, test/fix suggestions |
| AI boundary | Advisory only, never final authority |
| Production scanning | Not in MVP |
| Slack notifications | Not in MVP |
| Hosted dashboard | Later phase |
| GitHub Action | Later companion mode |
| Long-term platform | Product-security control assurance graph |

This combines the correct strategic base with the stronger execution model:

- the product category remains AI-built and fast-moving SaaS security readiness
- Lovable + Supabase is the first concrete wedge
- the first product is a local-first local CLI
- the ingestion model remains local-first, low-trust, and safety-first
- the first checks stay narrow and high-confidence

---

## 6. Target Users

### First target users

The first users should be:

- founders building Lovable + Supabase apps
- solo developers preparing AI-built apps for launch
- agencies building Lovable/Supabase apps for clients
- AI app studios
- technical founders preparing for B2B launch
- small SaaS teams facing customer security questions
- consultants who want repeatable security checks

### Later target users

Later, the product can expand toward:

- AppSec teams
- platform engineering teams
- product security architects
- regulated SaaS companies
- internal security review teams
- compliance and risk teams

---

## 7. MVP Product Shape

The MVP should be a local-first CLI with optional connected context collection.

### First scan flow

1. User exports or syncs a Lovable + Supabase project to a local repository.
2. User exports Supabase schema/RLS metadata, or optionally connects Supabase MCP in read-only, project-scoped mode.
3. User runs:

```bash
veyra scan \
  --project ./my-app \
  --supabase-schema ./supabase/schema.sql \
  --out veyra-report.md
```

4. Veyra scans the repository for:
   - secrets patterns
   - dependency risks
   - Supabase client usage
   - route/auth patterns
   - frontend-only protection
   - unsafe access patterns
5. User may optionally connect Lovable MCP so Veyra can collect declared project context:
   - app purpose
   - roles
   - protected routes
   - admin routes
   - tenant/user-owned resources
   - storage usage
   - business-critical actions
6. Veyra analyzes Supabase security metadata from:
   - uploaded schema/RLS/storage export
   - SQL snippet they run manually
   - generated metadata file
   - optional read-only Supabase MCP connector
7. Veyra analyzes:
   - RLS status
   - RLS policies
   - storage buckets
   - public access risk
   - tenant isolation evidence
   - missing tests
8. Veyra generates:
   - launch blockers
   - confirmed issues
   - likely issues
   - missing evidence
   - coverage gaps
   - control cards
   - suggested negative tests
   - Markdown readiness report
   - JSON readiness report

### CLI outputs

The first version should produce:

- `veyra-report.md`
- `veyra-report.json`
- control cards
- scanner artifacts
- suggested negative tests

The CLI should support:

```bash
veyra scan --project ./app --supabase-schema ./schema.sql
veyra scan --project ./app --supabase-schema ./schema.sql --fail-on-blocker
veyra scan --project ./app --supabase-schema ./schema.sql --json
```

The `--fail-on-blocker` flag should return a non-zero exit code when confirmed launch blockers are found. This enables CI usage without needing PR comments in the first release.

---

## 8. Trust and Data Access Model

Because Veyra is a security product, trust must be designed from day one.

The MVP should avoid privileged access.

### Data access principles

| Area | MVP Decision |
|---|---|
| Source code | Read from local filesystem by default |
| GitHub access | Not required in Phase 1 |
| Repository write access | Not required |
| Lovable MCP | Optional, OAuth-based, read/context allowlist only |
| Supabase MCP | Optional, `read_only=true`, project-scoped |
| Supabase service-role key | Not required |
| Supabase production data | Not accessed |
| Production scanning | Not performed |
| Database mutation | Not allowed |
| Runtime user data | Not accessed |
| Secrets found in code | Redacted immediately |
| Stored data | Local artifacts, findings, metadata, evidence, redacted snippets |
| AI input | Optional; sanitized evidence only |
| Fixes | Suggested only |
| PR comments | Not in Phase 1 |
| Human review | Required for final decisions |

### Trust documentation

The repository should include a document called:

# Data Access & Trust

It should clearly show:

| Data | Access Level |
|---|---|
| Source code | Local filesystem by default |
| GitHub repository | Not required in Phase 1 |
| Lovable MCP | Optional read/context allowlist |
| Supabase production data | Not accessed |
| Supabase service-role key | Not required |
| Secrets | Redacted |
| Production systems | Not scanned |
| Fixes | Suggested only |
| AI decisions | Advisory only |
| User data | Not collected |
| Permissions | Least privilege |

This page is important for local-first adoption and contributor trust.

### Veyra security model

Veyra itself must be treated as security-sensitive software.

Phase 1 local CLI requirements:

- source code is read from the local filesystem
- reports are written locally
- secrets are redacted before being stored in artifacts
- raw secret values must not be sent to AI providers
- MCP connections are optional and explicit
- mutation-capable MCP tools are denied by policy
- scanner execution is local
- no production scanning is performed
- no database writes or migrations are performed

Future hosted requirements:

- least-privilege connectors
- isolated scan jobs
- encrypted storage for metadata and artifacts
- strict tenant isolation
- audit logs for connector use and report access
- configurable data retention
- raw secret non-retention by default
- incident/breach response process
- clear admin-access controls for maintainers/operators

This security model should be documented publicly before asking users to connect private repositories or MCP accounts.

---

## 9. Phase 1 Report and Future Dashboard

Phase 1 should not build a hosted dashboard. It should build the report model and control-card primitives that a future dashboard can display.

The first experience should feel like a **launch security review**, not a generic vulnerability dump.

### Phase 1 report sections

The Markdown/JSON report should include:

- project name/path
- detected stack
- Supabase metadata status
- scan date
- readiness status
- number of launch blockers
- number of missing-evidence controls

Readiness states:

- **Blocked**
- **Needs Review**
- **Launch Ready With Notes**
- **Unknown / Not Enough Evidence**

---

### 9.1 Launch Blockers

High-confidence issues that should be fixed before production.

Examples:

- Supabase service-role key exposed
- `.env` file committed
- RLS disabled on sensitive table
- RLS enabled but no policies
- broad `using (true)` RLS policy
- public sensitive storage bucket
- frontend-only admin protection
- missing tenant/user constraint
- critical dependency vulnerability

---

### 9.2 Findings

Each finding should include:

- title
- severity
- finding type
- evidence strength
- affected file/table/policy
- explanation
- suggested fix
- suggested test
- confidence level
- review action

---

### 9.3 Control Cards

Control cards are the foundation of the long-term platform and must exist in Phase 1, even if the storage format is simple JSON.

Phase 1 graph primitives:

```text
control_id -> expected_behavior
control_id -> evidence_refs[]
control_id -> findings[]
control_id -> suggested_tests[]
control_id -> readiness_status
```

Example:

```yaml
control_id: AUTHZ-TENANT-001
title: Tenant users cannot access records from another tenant
status: missing_evidence
risk: high
finding_type: coverage_gap
evidence_strength: medium
reproducibility: static
blast_radius: tenant_data
review_action: review_before_launch

expected_behavior:
  - A user can only read records belonging to their own tenant.
  - Tenant identity must come from trusted session/server context.
  - Client-provided tenant_id must not be trusted.

available_evidence:
  - RLS enabled on some tables
  - Route references tenant_id
  - No negative test found

missing_evidence:
  - No test proving cross-tenant access is denied
  - No clear server-side ownership check found

recommendation:
  - Add negative authorization test.
  - Verify RLS policy enforces tenant ownership.
  - Ensure backend/API does not trust client-provided tenant_id.
```

---

### 9.4 Supabase/RLS Section

The report should show:

- tables with RLS enabled
- tables with RLS disabled
- tables with no policies
- broad policies
- risky policies
- policies that need manual review
- public storage buckets
- sensitive-looking bucket names
- policy interpretation in plain language

---

### 9.5 Suggested Tests

Generates test ideas such as:

- User A cannot read User B profile.
- Tenant A cannot list Tenant B invoices.
- Anonymous user cannot access admin route.
- Authenticated non-admin cannot update roles.
- Public user cannot download private storage object.
- User cannot access resource by guessing another ID.

These should be suggestions, not proof.

---

### 9.6 Future Hosted Dashboard

A later hosted dashboard can display the same data model with:

- project overview
- launch blockers
- findings
- control cards
- Supabase/RLS view
- suggested tests
- report exports
- shareable evidence packets

---

## 10. Finding Model

Veyra must distinguish between confirmed problems and missing evidence.

This is critical for trust.

### Finding types

```yaml
finding_type:
  - confirmed_issue
  - likely_issue
  - missing_evidence
  - coverage_gap
  - informational
```

### Evidence strength

```yaml
evidence_strength:
  - low
  - medium
  - high
```

### Reproducibility

```yaml
reproducibility:
  - static
  - mcp_context
  - tool_output
  - manual_review_required
  - active_validation   # Phase 2; reserved value in Phase 1
```

### Review action

```yaml
review_action:
  - fix_before_launch
  - review_before_launch
  - add_test
  - monitor
  - accept_with_owner
```

### Blast radius

```yaml
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

### Readiness status

```yaml
readiness_status:
  - launch_blocker
  - needs_review
  - evidence_present
  - proven_in_sandbox   # Phase 2; reserved value in Phase 1
```

### Evidence kinds (discriminated union)

```yaml
evidence_kind:
  - static_code           # file:line reference, Phase 1
  - mcp_context           # declared via Lovable/Supabase MCP, Phase 1
  - scanner               # gitleaks / OSV / semgrep finding, Phase 1
  - active_validation     # Phase 2 sandbox test outcome
  - cleanup_proof         # Phase 2 cleanup receipt
```

### Example finding

```yaml
finding_id: VEY-SUPABASE-RLS-001
title: RLS disabled on sensitive table
finding_type: confirmed_issue
severity: critical
evidence_strength: high
reproducibility: static
blast_radius: tenant_data
review_action: fix_before_launch

evidence:
  table: invoices
  rls_enabled: false

explanation:
  The invoices table appears to contain tenant/user data, but Row Level Security is disabled.
  If the application relies on client-side Supabase access, this may allow unauthorized access.

recommendation:
  Enable RLS and add policies that restrict access by authenticated user or tenant context.
```

---

## 11. First High-Confidence Launch Blocker Checks

The MVP should start with fewer checks and higher confidence.

The broader plan can eventually cover 20-30 checks, but the first hosted MVP should not treat all checks as launch blockers. Early trust depends on being precise, evidence-backed, and clear about uncertainty.

### Initial 12 checks

| # | Check | Type |
|---|---|---|
| 1 | Supabase service-role key exposed in repository | confirmed_issue |
| 2 | `.env` or secret file committed | confirmed_issue |
| 3 | RLS disabled on sensitive table | confirmed_issue |
| 4 | RLS enabled but no policies | confirmed_issue |
| 5 | Broad RLS policy such as `using (true)` | likely_issue |
| 6 | All-authenticated users can access sensitive table | likely_issue |
| 7 | Public sensitive storage bucket | confirmed_issue |
| 8 | Client-side use of privileged keys | confirmed_issue |
| 9 | Direct object access without tenant/user constraint | likely_issue |
| 10 | Admin route without clear server-side role check | likely_issue |
| 11 | Frontend-only route protection | likely_issue |
| 12 | Missing negative auth/RLS tests | missing_evidence |

### Later warning checks

These are useful but should not be launch blockers until accuracy improves. They belong in the backlog or as low-confidence warnings:

- policy trusts client-provided tenant/user value
- sensitive table has public read access
- sensitive table has public insert/update/delete
- suspicious dependency name
- missing rate limit
- unsafe file upload
- permissive CORS
- missing audit logs
- undocumented endpoint
- missing lockfile
- missing ownership metadata
- weak error handling
- missing CSRF protection where relevant
- debug/test endpoint exposed
- dependency added without review context
- outdated auth/security dependency

---

## 12. AI Responsibilities

AI should assist, not decide.

**Phasing:** Phase 1 ships only the AI provider adapter interface. No
provider is wired in Phase 1. AI capability lands in Phase 2
(`phases/phase-2/PHASE_2_PLAN.md §10`). The rules below apply across all
phases that include AI.

### AI should do (Phase 2+)

- explain findings in plain language
- map findings to controls
- summarize risk
- refine suggested tests (the deterministic catalog generates the list;
  AI rewrites for clarity using declared context)
- suggest remediation options
- interpret RLS policies
- produce launch-readiness summaries
- generate developer-friendly report text
- help prioritize findings

### AI should not do (any phase)

- be the source of truth for findings
- classify findings (`finding_type`, `evidence_strength`, `review_action`,
  `blast_radius`, `readiness_status` are all deterministic)
- approve launch
- accept risk
- exploit production systems
- mutate data
- change permissions
- auto-merge fixes
- hide uncertainty
- claim compliance
- create incidents automatically
- generate executable artifacts (SQL, code, migrations, shell commands)
- run tool-use loops that take state-changing actions

### AI output requirements

Every AI-generated explanation must include:

- evidence reference
- `confidence` level (`low | medium | high`)
- `uncertainty_notes`
- recommended human review action
- model id + provider (so a future change in model version is auditable)

---

## 13. MVP Architecture

```text
Local CLI
      |
      v
Scan Orchestrator
      |
      |-- Local Repository Reader
      |-- Optional Lovable MCP Context Connector
      |-- Supabase Metadata Export Reader
      |-- Optional Supabase MCP Read-Only Connector
      |
      v
Agent Layer
      |
      |-- Product Understanding Agent
      |-- Tool Runner Agent
      |-- Supabase/RLS Agent
      |-- Authn Agent
      |-- Authz/Tenant Boundary Agent
      |-- Business Logic Agent
      |-- Evidence/Report Agent
      |
      v
Tool Adapters
      |
      |-- Gitleaks
      |-- OSV-Scanner / npm audit
      |-- Semgrep custom rules
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
      |
      v
CLI Output + Exit Code
```

---

## 14. Scanner and Analyzer Responsibilities

### Deterministic scanners should produce findings

Examples:

- exposed secret detected
- RLS disabled
- public bucket found
- dependency vulnerability found
- `.env` committed

### AI should explain and enrich findings

Examples:

- explain why the issue matters
- map issue to launch risk
- suggest negative tests
- suggest remediation
- generate report summary

AI must be optional in the local-first version. The deterministic scanner should still produce useful findings and reports without an AI provider key. When AI is enabled, it should operate through a provider-agnostic adapter and receive sanitized evidence only.

This separation prevents the product from becoming an unreliable AI wrapper.

---

## 15. Security Controls to Model First

The first control categories are an opening set, not a closed taxonomy.
The control catalog at `src/agents/evidence-report/controls.ts` is the
canonical source; new categories can be added without changing the report
shape (per `§2A` extensibility rules).

### Phase 1 initial categories

1. Authentication
2. Authorization
3. Tenant isolation
4. Supabase RLS
5. Supabase storage access
6. Secrets management
7. Dependency / supply-chain risk
8. Security test coverage
9. Admin access
10. API access control

### Later-phase categories (illustrative)

These are the kinds of categories the control catalog must support adding
without rewriting types or reporters:

- API surface authz (REST, GraphQL, gRPC, WebSocket, tRPC)
- Async message-bus authz (Kafka, NATS, RabbitMQ topic ACLs)
- Identity-provider configuration (Clerk, Auth0, Cognito, etc.)
- Storage authz (S3, R2, GCS, Azure Blob)
- IaC drift and least-privilege (Terraform, Pulumi, CloudFormation)
- CI/CD supply chain (provenance, signed releases, SBOM coverage)
- MCP server tool surface and credential scoping
- AI provider call patterns, prompt-injection surfaces, output handling
- Agent framework approval flows and tool registries
- Runtime / observability evidence (Phase 4+)
- Compliance evidence packaging (Phase 4+)

---

## 16. First 8-Week Execution Plan

| Week | Focus | Output |
|---|---|---|
| 1 | Define product scope, 10–12 launch-blocker controls, evidence schema, and agent contracts | Control model, finding types, severity model, agent interfaces |
| 2 | Build CLI, scan orchestrator, artifact store, and report skeleton | `veyra scan`, Markdown/JSON stub report |
| 3 | Add local project inventory, Supabase schema/RLS parser, and minimal control graph primitives | Evidence inventory and control cards |
| 4 | Add Gitleaks and OSV/npm audit adapters | Redacted secrets findings and dependency findings |
| 5 | Add Semgrep custom-rule adapter for route/auth patterns | Initial route/authz findings |
| 6 | Add optional Lovable MCP and Supabase MCP read-only context collectors | Declared context and metadata artifacts |
| 7 | Add suggested tests, optional AI explanation adapter, and `--fail-on-blocker` | Useful CLI output and CI-ready exit code |
| 8 | Test against fixture plus 5 real or representative projects and manually verify findings | Case studies, false-positive review, improved checks |

The first validation cycle should manually verify every finding. The goal is not volume of findings; it is whether real users trust the report and act on it.

---

## 17. Phase Roadmap

## Phase 1 — Veyra local-first CLI

### Goal

Build a local-first CLI that analyzes one Lovable + Supabase project as the first concrete version of the broader AI-built SaaS security-readiness platform.

### Must include

- `veyra scan`
- Markdown and JSON report output
- local repository scanning
- Supabase metadata export/import
- optional Lovable MCP context collection
- optional Supabase MCP read-only metadata collection
- high-confidence launch blocker checks
- RLS/storage analysis
- Gitleaks or compatible secrets scanning
- OSV-Scanner or npm audit dependency scanning
- Semgrep custom-rule adapter for route/auth patterns
- control cards
- minimal control graph primitives
- AI provider adapter interface only (no provider wired; AI capability ships in Phase 2 — see `phases/phase-2/PHASE_2_PLAN.md §10`)
- suggested negative tests
- `--fail-on-blocker`
- vulnerable fixture project for regression testing

### MVP goal

Prove that Veyra can find real, high-value security issues in Lovable + Supabase apps and explain them clearly enough that developers trust and act on them.

### Must avoid

- hosted dashboard
- Slack notifications
- enterprise SSO
- complex RBAC
- production-active scanning
- offensive tools
- compliance claims
- autonomous fixes
- broad framework support

### Success criteria

- gold fixture covers the 12 initial checks with known expected results
- at least 5 real or representative projects scanned
- every finding manually verified
- at least 3 of 5 manually reviewed scans surface a finding or missing-evidence gap that was not already obvious to the user
- at least 1 external user or team runs it independently and says they would use it again
- users understand the report without security expertise

---

## Phase 2 — Sandbox Active Validation + AI-Assisted Reasoning + Design-Partner Polish

### Goal

Turn the MVP into a tool that can **prove** controls in sandbox environments
and **explain** findings with AI assistance, while also becoming repeatable
enough for early design partners. Detailed plan:
`phases/phase-2/PHASE_2_PLAN.md`.

### Add (capability)

- `--mode sandbox_active_validation` actually works
- `SandboxExecutor` behind the `ActionExecutor` interface introduced in
  Phase 1's policy types
- Synthetic identity / tenant / record creation via Supabase Admin SDK
- Negative-test catalog (cross-tenant read, client-tenant_id override,
  anon-to-private-bucket, non-admin-to-admin-route, etc.)
- Cleanup machinery with verifiable residual count
- AI provider adapter (Anthropic + OpenAI) actually wired
- `ai-explainer` agent for sanitized, structured-output explanations
- New evidence kinds emitted at runtime: `active_validation`,
  `cleanup_proof`
- New readiness status emitted: `proven_in_sandbox`
- Approval flow (interactive + signed-file CI path)

### Add (polish — design partners)

- improved onboarding
- GitHub Action companion
- scan history
- finding suppression with expiry
- better RLS interpretation
- simple team/project support
- local HTML report
- richer report export

### Success criteria

- The vulnerable fixture, run with `--mode sandbox_active_validation`,
  produces at least one `proven_denial` per supported control and at least
  one `proven_allowed` for seeded broken controls.
- Cleanup proof shows `residual_count: 0` after every scan.
- `--no-ai` still produces a complete report.
- 5–10 design partners running real scans.
- Repeated scans by the same teams.
- Real fixes traceable to findings.
- Reduced security review time.

---

## Phase 3 — Focused Product

### Goal

Become the default launch security-readiness tool for AI-built and fast-moving SaaS apps, starting with Supabase-backed products.

### Add

- optional hosted dashboard
- multi-project support
- agency workflows
- customer-facing readiness reports
- more framework patterns
- Firebase or other backend support exploration
- limited Supabase connector
- policy profiles
- richer control graph

### Success criteria

- clear positioning
- repeatable demo
- strong case studies
- active external usage
- external contributors or community feedback

---

## Phase 4 — Product Security Control Assurance Platform

### Goal

Expand from launch readiness into continuous control assurance.

### Add

- API route mapping
- OpenAPI support
- CI/CD gates
- runtime/authz log ingestion
- ownership mapping
- Jira/GitHub Issues integration
- exception workflow
- control evidence history
- customer security review packs

### Success criteria

- AppSec teams use it
- product teams use it in release workflows
- evidence supports customer reviews
- control graph becomes the main differentiator

---

## Phase 5 — Enterprise Platform

### Goal

Become a broader continuous product-security control assurance platform.

### Add

- enterprise SSO
- RBAC
- audit logs
- BYOC/self-host option
- cloud/runtime connectors
- SIEM integrations
- approval workflows
- safe live-product validation
- compliance evidence support
- controlled offensive validation workflows

### Success criteria

- mid-market/enterprise adoption
- trusted by security teams
- control graph differentiates from scanner dashboards
- evidence is reusable for audits and customer reviews

---

## 18. What Not To Build First

Do not build these in the MVP:

- Slack notifications
- generic AppSec dashboard
- full compliance reports
- DORA/GDPR/NIS2 claims
- live production scanning
- offensive security tools
- autonomous remediation
- auto-merge fixes
- enterprise RBAC
- SSO/SAML
- full scanner orchestration
- CNAPP features
- SIEM features
- Kubernetes/runtime monitoring
- mobile app
- complex charts
- marketplace
- AI chat interface as the main product

---

## 19. Positioning

### Main positioning

> **Veyra checks whether your AI-built SaaS app is safe enough to launch: auth, authorization, tenant isolation, secrets, storage, and missing security tests.**

### Supabase-specific positioning

> **For Supabase-backed apps, Veyra checks RLS, storage buckets, service-role key exposure, tenant-isolation evidence, and missing negative authorization tests.**

### Lovable-specific positioning

> **Before your Lovable app goes live, Veyra checks for missing auth, weak Supabase RLS, exposed keys, public buckets, and tenant-isolation gaps.**

### Developer positioning

> **Get practical, evidence-backed security feedback tied to your repo, Supabase policies, and launch blockers.**

### Founder positioning

> **Avoid shipping your AI-built SaaS with obvious security gaps.**

### Agency positioning

> **Run a repeatable security-readiness review before handing over a Lovable/Supabase app to a client.**

### Future enterprise positioning

> **Continuous product-security control assurance across code, APIs, authorization, runtime signals, ownership, and evidence.**

---

## 20. Validation Plan

Before investing heavily, validate these assumptions.

### User pain

- Do Lovable/Supabase builders worry about production security?
- Do they understand RLS and tenant isolation risks?
- Have agencies had client security concerns?
- Do founders need security readiness before B2B launch?
- Are users willing to run a local CLI against their app?
- Are users comfortable uploading Supabase metadata?

### Product usefulness

- Does Veyra find real issues?
- Are findings accurate?
- Are false positives acceptable?
- Do users understand the CLI report?
- Do users fix issues after reading the report?
- Do suggested tests help?

### Adoption

- Who uses it first?
  - founder
  - agency
  - technical lead
  - consultant
  - security team
- Is Lovable a strong enough acquisition wedge?
- Is AI-built SaaS launch security a large enough category?
- Is Supabase-backed app security a strong enough first wedge?

### Trust

- Do users trust the local-first data access model?
- Is the data access model clear?
- Are secrets safely redacted?
- Are AI explanations grounded enough?
- Does the product avoid overclaiming?

---

## 21. Success Metrics

### Product metrics

- projects scanned
- scans completed
- reports generated
- repeated scans
- findings reviewed
- suggested tests copied/used
- `--fail-on-blocker` usage

### Security metrics

- launch blockers found
- exposed secrets detected
- RLS issues found
- public buckets found
- missing negative tests found
- critical dependency issues found
- fixed findings

### Adoption metrics

- design partners recruited
- monthly active projects
- external contributors or issue reporters
- support burden
- time to first value

### Trust metrics

- percentage of users completing a local scan
- percentage of users providing Supabase metadata
- false-positive rate
- manually verified finding accuracy
- user confidence rating

---

## 22. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Security-tool trust friction | Start local-first, require no source upload, no service-role key, and no production DB access |
| AI hallucination | AI explains only evidence-backed findings; include confidence and uncertainty |
| False positives | Start with 10–12 high-confidence checks; classify likely vs confirmed issues |
| False negatives | Report coverage gaps; never claim “secure” |
| Lovable too narrow | Market through Lovable but build around Supabase-backed apps |
| Weak adoption urgency | Validate with agencies, technical founders, AI app studios, and small B2B SaaS teams |
| Scanner noise | Focus on launch blockers and control cards |
| Secrets exposure | Redact immediately and avoid storing raw secrets |
| Compliance overclaiming | Say “readiness evidence,” not “compliance certified” |
| Overbuilding dashboard | Do not build the dashboard in Phase 1; keep the first product focused on CLI, controls, and reports |
| Too much scope | Avoid Slack, SSO, offensive tooling, runtime, compliance in MVP |
| Security of Veyra itself | Least privilege, encryption, audit logs, isolated scan jobs, secret redaction |

---

## 23. Why This Is More Than an AI Wrapper

Veyra becomes a serious product if it owns the control model.

A weak product says:

> Here are scanner findings summarized by AI.

A strong product says:

> Here are the security controls your app needs before launch, the evidence we found, the evidence missing, the launch blockers, and the tests you should add.

The long-term moat is:

- Supabase/RLS-specific understanding
- tenant-isolation control modeling
- evidence-backed launch review
- control cards
- developer-friendly remediation
- high-confidence launch blockers
- generated negative tests
- safe, low-trust security review workflow

### What Veyra should not compete with directly

Veyra should not try to replace:

- Snyk
- Semgrep
- GitHub Advanced Security
- GitLab Security
- Wiz
- Orca
- Checkmarx
- Veracode
- Burp Suite
- OWASP ZAP
- SIEM platforms
- CNAPP platforms

Those tools are strong in scanning, vulnerability databases, runtime/cloud visibility, and enterprise workflows.

Veyra should differentiate through:

- focus on AI-generated and fast-moving SaaS apps
- stack-specific knowledge of Lovable + Supabase as the first wedge
- RLS and tenant-isolation interpretation
- control-evidence graph
- **sandbox active validation that proves controls deny synthetic actors,
  not only observes static patterns** (Phase 2; the moat that scanner
  dashboards structurally cannot replicate)
- **verifiable cleanup as evidence** (Phase 2; `residual_count: 0` is a
  first-class report artifact, not an afterthought)
- production-readiness workflow
- developer-friendly explanations
- launch-focused security checklist
- evidence-backed AI output with sanitized inputs, structured outputs, and
  required confidence/uncertainty labelling
- safe, human-reviewed recommendations

The Phase 1 deterministic backbone (`read_only_evidence` mode) is **table
stakes** as of 2026-05 — comparable static scanners for Lovable + Supabase
apps already exist (Vibe-Scanner, Symbiotic Security, securifyai's RLS
Scanner, Lovable's own built-in). Veyra's defensible position comes from
the combination of (a) control-evidence graph as the report shape, (b)
sandbox active validation as the proof mechanism in Phase 2, and (c)
allowed-claims vocabulary that keeps the product honest.

---

## 24. Final Recommendation

Build Veyra as:

> **A local-first security-readiness platform for AI-built and fast-moving SaaS apps, starting with Supabase-backed Lovable projects, using low-trust ingestion and evidence-backed control cards.**

The MVP should focus on:

- local CLI scanning
- Supabase metadata import
- optional Lovable MCP context
- optional Supabase MCP read-only metadata
- RLS/storage analysis
- secrets scanning
- dependency scanning
- Semgrep route/auth rules
- route/auth pattern detection
- launch blockers
- finding classification
- control cards
- minimal control graph primitives
- suggested negative tests
- Markdown readiness report
- JSON readiness report
- `--fail-on-blocker`

Do not build first:

- hosted dashboard
- Slack
- live production scanning
- offensive tooling
- compliance packs
- enterprise RBAC
- autonomous remediation
- generic AppSec dashboard

The first major milestone is:

> **Five real teams use Veyra before launch, every finding is manually verified, and at least one team says it found something important enough to use again.**

That is the right first step toward a future product-security control assurance platform.
