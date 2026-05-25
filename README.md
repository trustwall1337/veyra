# Veyra

> Security readiness for AI-built SaaS apps.

Veyra helps teams verify whether important product-security controls are
present, testable, and evidenced before an app is exposed to real users.

The first focus is **Lovable + Supabase** applications, especially risks around
authentication, authorization, tenant isolation, Supabase RLS, storage access,
secrets, dependencies, and missing negative tests.

## Name

**Veyra** suggests verification, evidence, and readiness without locking the
product to one stack, vendor, or deployment model.

## Product Shape

Veyra is not intended to be a scanner dashboard or an AI chat wrapper. The core
product is a control-evidence graph:

```text
product context -> observed facts -> AI hypotheses -> deterministic assertions
                -> control cards -> readiness report -> optional active tests
```

The first stack is Lovable + Supabase because it gives concrete launch risks:
frontend-only checks, weak authorization, missing tenant boundaries, broad RLS
policies, public buckets, exposed service-role keys, and missing negative tests.

The architecture should support other stacks later. Lovable and Supabase are the
first adapters, not the permanent boundary of the product.

## AI-First Architecture

Veyra uses AI where it improves understanding and planning, while deterministic
code remains responsible for evidence, policy, execution, and final status.

### 1. Observation Layer

The observation layer records raw facts. It should avoid making broad security
claims.

Examples:

- `orders` has no detected RLS enablement statement.
- `/api/invoices/:id` reads an object by request id.
- a route appears protected only in the frontend.
- a scanner produced a redacted secret finding.
- Lovable declared that the app has tenants, invoices, and admin users.

Primary artifacts:

- `scan-facts.json`
- `declared-context.json`
- scanner outputs
- MCP context artifacts

### 2. AI Inference Layer

The inference layer reads observed facts and project context, then produces
hypotheses.

Examples:

- this appears to be a multi-tenant invoicing app
- invoices and payment methods look tenant-scoped
- admin role changes look business-critical
- this route may expose direct object access
- this workflow needs a negative authorization test

AI outputs are advisory and must include confidence, uncertainty, model id, and
evidence references. They are not final findings.

Primary artifacts:

- `hypotheses.json`
- `context-requests.json`
- AI reasoning metadata

### 3. Deterministic Assertion Layer

The assertion layer turns facts and hypotheses into reviewed outcomes using
fixed predicates, policies, and catalog rules.

Examples:

- does a route use `req.params.id` without an owner or tenant constraint?
- does a sensitive table have RLS disabled?
- does a policy grant all rows to `authenticated`?
- does a finding have enough evidence to become a launch blocker?

Only this layer computes:

- `finding_type`
- `evidence_strength`
- `review_action`
- `blast_radius`
- `readiness_status`

Primary artifacts:

- `assertions.json`
- `findings.json`
- `control-cards.json`
- `readiness-report.json`

## Planning And Validation Flow

AI can help plan the scan, but policy-gated code controls what actually runs.

```text
Repository / Lovable / Supabase metadata
        |
        v
Observation collectors
        |
        v
AI product understanding + inference
        |
        v
Deterministic assertions
        |
        v
AI security planner
        |
        v
Policy compiler
        |
        v
Read-only report or approved sandbox validation
```

The AI security planner may request more context, prioritize checks, and suggest
test targets from the closed catalog. It must not hold credentials, call MCP
tools directly, invent executable tests, or mutate systems.

Connectors call Lovable and Supabase under policy. AI reads sanitized artifacts
and may produce context requests. The policy layer decides whether those
requests are allowed.

The mandatory baseline always runs. AI may add depth, priority, context, and
planning, but it must not remove required checks silently.

## Trust Model

Veyra should report which controls were checked, which evidence was found, which
evidence was missing, and which areas need human review. It must not claim final
assurance or compliance.

Veyra should not mutate production systems, change permissions, exfiltrate data,
auto-merge fixes, or make final security decisions.

AI must not:

- classify findings as final authority
- decide launch readiness
- execute code, SQL, shell commands, migrations, or MCP tools directly
- invent active tests at runtime
- hide uncertainty

Deterministic code must:

- enforce connector/tool policy
- redact secrets before storage or AI use
- keep raw user data out of AI prompts
- compile executable plans from allowed actions only
- preserve a complete report path when AI is disabled

## Documentation

- [`docs/phase-1.md`](./docs/phase-1.md) — Phase 1 overview, CLI flags,
  how to run a scan, how to read the report, known limits.
- [`docs/lovable-mcp-safety.md`](./docs/lovable-mcp-safety.md) — Lovable
  MCP allowlist + fixed prompt templates.
- [`docs/supabase-metadata-export.md`](./docs/supabase-metadata-export.md)
  — what Supabase metadata Veyra reads, and how to export `schema.sql`.
- [`docs/data-access-and-trust.md`](./docs/data-access-and-trust.md) —
  the trust model in plain language, with non-goals.

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
```
