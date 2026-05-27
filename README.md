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

## What Veyra is

Veyra is an **agentic, bounded-multi-agent security-readiness analyzer**. An AI
orchestrator reasons about your specific app to decide what to check and can
spawn focused **sub-agents** to deep-dive a single target; a deterministic policy
gate authorizes every action; deterministic predicates own every classification
and every launch decision. Intelligence is the substrate; determinism is the
trust spine.

It is not a scanner dashboard, not an AI chat wrapper, and not an autonomous
remediation bot. It is a control-evidence platform whose first analyzer targets
Lovable + Supabase apps — frontend-only checks, weak authorization, missing
tenant boundaries, broad RLS policies, public buckets, exposed service-role
keys, and missing negative tests. The architecture supports other stacks later;
Lovable and Supabase are the first adapters, not the permanent boundary.

## How a scan works

```text
orchestrator proposes the next tool call (or spawns a deep-dive sub-agent)
        |
        v
deterministic policy gate authorizes it  (denies anything outside the allowlist / policy)
        |
        v
the tool runs; its result is parsed-or-rejected before it can persist
        |
        v
repeat until a deterministic termination fires (done / budget / stall)
        |
        v
deterministic floor classifies facts into Findings, runs cleanup, authors the report
```

The orchestrator decides *what to check and in what order*. The deterministic
floor decides *what is a finding* and *what blocks launch*. Those two
responsibilities never mix.

## The orchestrator

The orchestrator is Veyra's reasoning engine — the agent that runs the entire
scan. It reads the app's code, schema, and metadata; builds a working
understanding of what the app is (its entities, roles, tenant model, sensitive
flows); and from that understanding decides, step by step, which tool to call
next. It is not following a fixed checklist — it chooses the next action from
the available tools based on everything it has learned so far in the scan, and
it decides when the scan is done.

Crucially, the orchestrator proposes; it does not act unilaterally. Every action
it wants — read a file, query schema, run a scanner, fire a probe, spawn a
sub-agent — is a *proposal* that the deterministic policy gate authorizes or
denies before anything happens. The orchestrator never holds a credential, never
classifies a finding, and never decides launch readiness; it directs the
investigation, and the deterministic spine adjudicates and judges.

## Sub-agents (bounded deep-dive)

When a single target deserves deeper investigation than the main loop should
spend inline — one table's full policy graph, one suspected IDOR across an actor
pair — the orchestrator spawns a **deep-dive sub-agent** dedicated to that one
target. The sub-agent investigates thoroughly, then returns its findings as
facts to the orchestrator, which folds them into the rest of the scan.

Sub-agents make the analysis deeper without making it less trustworthy, because
each one is *more* constrained than the orchestrator, never less:

- **Depth-1 only.** The orchestrator spawns sub-agents; a sub-agent cannot spawn
  sub-agents. Enforced at the gate, not by convention — no runaway agent trees.
- **One target each.** A sub-agent investigates exactly one declared target. No
  fan-out, no wandering.
- **Narrow tool subset.** A sub-agent sees only the tools relevant to its
  target, derived deterministically and asserted to be a strict subset of what
  the orchestrator could see. No new tool, and no broader capability, can enter
  through a sub-agent.
- **Budget debited from the parent.** A sub-agent spends from the scan's single
  budget. It can end the scan if it exhausts the budget, but it can never extend
  it.
- **Same trust spine.** Every sub-agent tool call passes the same policy gate and
  the same result-parse-or-reject boundary as the orchestrator. Sub-agents emit
  facts only — they never classify, exactly like the orchestrator.
- **Nested, auditable.** Every sub-agent step is logged with its `parent_step`
  and a `subagent_id`, so an operator can reconstruct exactly which deep-dive
  produced which piece of evidence.
- **Failure-isolated.** A sub-agent that fails turns its target into a
  `coverage_gap` and the orchestrator carries on — one deep-dive going wrong
  never takes down the scan.

This is deliberately *not* parallel fan-out and *not* a swarm of autonomous peer
agents negotiating with each other — both make it hard to answer "which agent
decided this, on what evidence," and a security tool whose findings must be
defensible can't afford that. The shape is one orchestrator, bounded deep-dive
sub-agents beneath it, and one deterministic trust spine that every agent —
parent or sub — passes through.

## Trust boundaries

Veyra reports which controls were **checked**, which evidence was **found**,
which evidence was **missing**, and which areas **need human review**. It does
not claim final assurance or compliance, and never describes an app as
"secure," "safe," or "compliant."

Veyra does not mutate production systems, change permissions, exfiltrate data,
auto-merge fixes, or make final security decisions.

**AI must not:**

- produce a Finding, or set `finding_type` / `evidence_strength` /
  `review_action` / `blast_radius` / `readiness_status` (the deterministic floor
  is the sole classifier — enforced by a tool-result schema that makes
  classification keys un-representable, plus an import-graph guard that keeps the
  `Finding` type unreachable from any tool)
- decide launch readiness
- call a tool the policy gate has not authorized, or any MCP method outside the
  allowlist (denied methods have no tool descriptor — AI cannot even name them)
- hold a raw secret, or see an unredacted tool result
- author a write that the cleanup registry cannot reverse
- terminate early to skip a baseline check (the required-evidence ledger turns a
  missing baseline into a `coverage_gap`, deterministically)

**Deterministic code must:**

- enforce connector/tool policy on every call (the gate is the inner loop)
- redact secrets before storage or AI use; gitleaks always runs with `--redact`
- keep raw user data and raw secrets out of AI prompts, artifacts, and the audit
  trail
- own all classification and the readiness decision
- track every write in a registry and reverse it at cleanup
- preserve a complete report path when AI is disabled (`--no-ai` runs a
  deterministic plan-walker over the same tools)

## Operating modes (trust matrix)

| Mode | Credential ask | What AI may author | Writes? | Cleanup | `--no-ai` |
|---|---|---|---|---|---|
| A (read-only evidence) | project path; optional read-only MCP | which read tools to call, in what order | none | n/a | static plan-walker, full Findings |
| **B.2 auto-synthesize (default Mode B)** | service-role key (env-only) | actor synthesis + read tools + probe request shapes within a typed schema | yes, registry-tracked (HTTP + Admin) | deterministic reverse-walk over both registries, `residual_count: 0` | read tools full Findings; write probes → `coverage_gap` |
| B.1 manifest (opt-in) | sandbox + declared actors (no service-role key) | read tools + probe request shapes within a typed schema | yes, registry-tracked | deterministic reverse-walk over both registries | read tools full Findings; write probes → `coverage_gap` |
| C (approved production) | reserved | reserved | reserved | reserved | reserved |

The default loop driver is **Anthropic via AWS Bedrock** (AWS credentials are
env-only). Direct Anthropic and OpenAI remain selectable providers. Mode B's
default is auto-synthesize (Veyra creates and cleans up its own test users);
manifest mode is the opt-in for operators who prefer not to provide a
service-role key. `--env production` with any active-validation mode is rejected.

## Audit

Every scan writes an append-only `loop-trace.jsonl`: one record per loop step
with the model id, a prompt fingerprint, the policy and tool-descriptor snapshot
hashes in force, the gate decision, the result-validation outcome, and the
redacted result digest. An operator can read it top-to-bottom to reconstruct
exactly which tools the AI chose, which the gate denied and why, which results
were rejected, and which deep-dive produced which evidence — so every finding is
defensible.

## Documentation

- [`docs/phase-1.md`](./docs/phase-1.md) — Phase 1 overview, CLI flags, how to
  run a scan, how to read the report, known limits (the shipped baseline).
- [`docs/lovable.md`](./docs/lovable.md) — how Veyra reads Lovable code today
  (local git clone) and why native Lovable fetch is deferred.
- [`docs/supabase-metadata-export.md`](./docs/supabase-metadata-export.md) — the
  Supabase Management REST API is the customer default (`--supabase
  <project_ref>`); contributor-only paths sit behind `VEYRA_DEV=1`.
- [`docs/data-access-and-trust.md`](./docs/data-access-and-trust.md) — the trust
  model in plain language, with non-goals.
- [`docs/active-validation.md`](./docs/active-validation.md) — Phase 2 active
  validation: Mode A vs Mode B, sub-mode B.1 vs B.2, what's checked, what's never
  done.
- [`docs/synthetic-data-and-cleanup.md`](./docs/synthetic-data-and-cleanup.md) —
  Phase 2 synthetic-data lifecycle, cleanup contract.
- [`docs/approval-flow.md`](./docs/approval-flow.md) — Phase 2 Mode B approval
  flow.
- [`docs/how-ai-fits.md`](./docs/how-ai-fits.md) — how the AI orchestrator,
  the gate, and the deterministic floor fit together in a scan.

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
```
