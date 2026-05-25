# Step 03b — CLI revision: AI flags wired per §12b opt-in matrix

**Status:** done (2026-05-25)
**Maps to:** `REVISION_AI_SHAPE.md §12b opt-in matrix`; revision §14 Q3, Q4, Q6
**Amends Phase 1 step:** 03
**Produces:** CLI extension at `src/cli/scan-command.ts` + help text
**Depends on:** 02b, 02c
**Executed by:** plain coding pass
**Verification:** argv unit tests per flag; rejection-path tests; default-invocation produces Findings-only report

## Goal

Wire the AI-related CLI flags from the revision's opt-in matrix. CLI parsing is independent of reporter rendering — `13b` consumes the parsed threshold later, but `03b` does not depend on `13b`. CLI's job here: parse, validate, expose typed config to downstream.

## What lands

- `src/cli/scan-command.ts` — add flags:
  - `--ai-provider <name>` — `anthropic` (Phase 1 default if AI is opted-in) or `openai` (Phase 2 fallback). When set without env var → reject at parse time with explicit "ANTHROPIC_API_KEY (or OPENAI_API_KEY) not set" message. Never silent fall-through.
  - `--no-ai` — boolean. Hard override. Skips layers 1b, 3, 5. Overrides any `--ai-provider` setting.
  - `--ai-hypothesis-budget <n>` — integer, default 100 (per revision §14 Q4). Honoured by 08d.
  - `--ai-concern-threshold <low|medium|high>` — default `medium`. The single AIConcern visibility control. No `--hide-low-confidence-concerns` flag.
  - `--ai-cache-ttl <5m|1h>` — prompt-cache TTL, default `5m`.
  - `--ai-model <model-id>` — model selection, default `claude-sonnet-4-6`.
- Help text mentions:
  - AI is **opt-in**. The deterministic baseline runs without any AI flag or env var.
  - The opt-in requires BOTH `--ai-provider` AND the corresponding env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
  - `--no-ai` is the hard override for CI runs that must not call AI even when opted-in elsewhere.

## Done when

- Argv unit tests cover every flag, every rejection path, every combination per revision §12b matrix:
  - no env var, no flag → AI skipped silently → Findings-only report.
  - env var, no flag → AI skipped silently → Findings-only report.
  - no env var, `--ai-provider anthropic` → reject at parse with explicit error.
  - env var + `--ai-provider` → AI opted-in.
  - env var + `--ai-provider` + `--no-ai` → AI skipped (override).
- `--ai-hypothesis-budget` value reaches 08d's runtime cap (integration test).
- `--ai-concern-threshold` value reaches 13b's rendering filter (integration test).
- Help text passes `output-language-lint`.

## Guardrails

- **Constraint 5:** API key read from env var only. Never on argv. CLI rejects keys that look like raw values (entropy + prefix heuristic).
- Per revision §12b: deferred-mode rejections (Phase 2 / later-phase modes) keep explicit "not yet implemented" messages with plan-doc pointers.
- Per `FPP §2A`: `--ai-provider` accepts any registered provider id; no hardcoded `'anthropic' | 'openai'` string union. The registry resolves at runtime.
- CLI does NOT depend on the reporter (13b). Parse-time validation only; runtime wiring is the orchestrator's job (18b).

## References

- `REVISION_AI_SHAPE.md` §12b opt-in matrix
- `phase-1/steps/03-cli-argv-and-dual-mode.md` (original `Status: done`) — this amendment adds AI flags without rolling back the original
- 02b (types), 02c (AiProvider interface)
