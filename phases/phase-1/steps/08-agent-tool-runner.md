# Step 08 — Tool-runner agent

**Status:** not started
**Maps to:** `PHASE_1_PLAN §7 Task 9`, §4.6
**Produces:** `src/agents/tool-runner/`
**Depends on:** 05, 06, 07
**Executed by:** `/new-agent` skill
**Verification:** Vitest with injected fake runners; assert normalized `scanner-findings.json`; assert one missing binary → `coverage_gap`, not whole-scan crash

## Goal

Wrap the three scanner adapters inside an agent. Reads project root from execution context, invokes each scanner with try-boundary isolation, normalizes outputs into a single artifact for the report agent to consume.

## What lands

- `src/agents/tool-runner/agent.ts` — implements `VeyraAgent<ToolRunnerInput, ToolRunnerOutput>`.
- `src/agents/tool-runner/index.ts` — re-exports metadata + agent.
- `src/agents/tool-runner/agent.test.ts` — unit tests with injected fake scanner adapters.
- Output artifact: `scanner-findings.json` with sections per scanner (`gitleaks`, `osv`, `semgrep`) and per-scanner status (`ok | not_installed | error`).

## Done when

- `/new-agent` skill checklist all green.
- Each scanner adapter is wrapped in an independent try-boundary. One scanner crashing or missing emits a `coverage_gap` finding for the relevant control and does not abort the agent.
- Stderr from each scanner is persisted to the artifact store for auditability (scrubbed for secret-like patterns first per step 05 guardrails).
- Normalized output has stable schema regardless of which scanners ran.

## Guardrails

- Agent must not contain security reasoning beyond classification. Decisions about whether a Semgrep hit is `likely_issue` vs `confirmed_issue` happen here (when evidence is direct) but agent must default to non-confirmed (per §4.6: "Run deterministic local tools and normalize outputs.").
- Agent must not call any other agent directly. It only reads from `AgentExecutionContext` and writes to the artifact store (per §4.0 composability rule).
- Subprocess executions inherit the adapter guardrails: array args, explicit timeout, no shell strings.

## References

- `PHASE_1_PLAN.md` §4.6 (Tool-runner controls), §7 Task 9
- `CLAUDE.md` §Architecture (agents communicate only via artifact store)
- `.claude/skills/new-agent/SKILL.md`
