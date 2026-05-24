---
name: new-agent
description: Use when scaffolding a new Veyra agent under `src/agents/<name>/` (one of the seven Phase 1 agents — product-understanding, authn, authz-tenant, supabase-rls, business-logic, tool-runner, evidence-report). Provides the VeyraAgent<I, O> contract, file templates, and the "before you finish" checklist. Do NOT use when editing an existing agent or for non-agent code.
---

# Skill: new-agent

Scaffold a new Veyra agent following the contract in CLAUDE.md §Architecture and PHASE_1_PLAN.md §4.0 (Agent Runtime Architecture) + §7 Task 2.

This skill assumes PHASE_1_PLAN §7 Task 2 (agent contracts and artifact store types) is complete. If `src/types/agent.ts` doesn't exist yet, do Task 2 first — the templates import from it.

## When to use

User asks to:
- "create / scaffold / add / implement a new agent"
- "build the authn / authz-tenant / supabase-rls / [...] agent"
- "stub out an agent under src/agents/"

Do NOT use when:
- editing logic inside an existing agent
- changing the agent contract itself (foundation change — go to §4.0)
- working on the orchestrator, artifacts, or policy modules

## The seven Phase 1 agents

Only these names are valid. Adding a new agent name is a scope decision — stop and ask the user.

1. `product-understanding` (PHASE_1_PLAN §4.1)
2. `authn` (§4.2)
3. `authz-tenant` (§4.3)
4. `supabase-rls` (§4.4)
5. `business-logic` (§4.5)
6. `tool-runner` (§4.6)
7. `evidence-report` (§4.7)

Read the relevant §4.<N> for that agent's purpose, inputs, outputs, and controls **before** writing anything.

## The contract

Every agent implements `VeyraAgent<I, O>` (from `src/types/agent.ts`):

```ts
interface VeyraAgent<I, O> {
  id: string;
  version: string;
  run(input: I, context: AgentExecutionContext): Promise<AgentResult<O>>;
}
```

### Hard architecture rule (CLAUDE.md §Architecture)

> **Agents communicate only through the artifact store, never by direct calls.**

This means:

- Never `import` from another agent's module.
- Never pass another agent's output directly — read it from the artifact store via `context.artifactDir`.
- The orchestrator owns ordering and dependency wiring.

Violation is a launch-blocker for Veyra itself. Verify in your diff that no `import` line points into a sibling `src/agents/*` folder.

## Files to create

Per the project's chosen layout (`<name>.ts`, not `index.ts`):

- `src/agents/<agent-name>/<agent-name>.ts` — primary implementation, exports the `VeyraAgent<I, O>` const
- `src/agents/<agent-name>/<agent-name>.test.ts` — Vitest tests next to source
- `src/agents/<agent-name>/types.ts` — agent-specific `I` (input) and `O` (output) types
- Remove `src/agents/<agent-name>/.gitkeep` if present

If an input or output type is shared across agents (rare in Phase 1), put it in `src/types/` instead and re-export from `types.ts`.

## Conventions (from CLAUDE.md)

- File names: kebab-case
- One primary exported entity per file
- No `any` — use `unknown` and narrow with type guards
- No non-null assertions (`!`) — handle `undefined` explicitly
- Errors are `Error` subclasses with descriptive names (e.g. `ParseError`, `PolicyViolationError`)
- Return `Result<T, E>` (from `src/types/result.ts`) for expected failure paths
- Throw only for unexpected failures
- Public functions and exported types get TSDoc comments

## Templates

Start from:
- `templates/agent.template.ts`
- `templates/agent.test.template.ts`

Both files use this placeholder convention:

| Placeholder         | Replace with                                   | Example         |
| ------------------- | ---------------------------------------------- | --------------- |
| `PlaceholderAgent`  | PascalCase agent class/const name              | `AuthnAgent`    |
| `placeholderAgent`  | camelCase instance/export name                 | `authnAgent`    |
| `'placeholder-agent'` | kebab-case agent id (string literal only)    | `'authn'`       |
| `PlaceholderInput`  | input type alias from `./types.js`             | `AuthnInput`    |
| `PlaceholderOutput` | output type alias from `./types.js`            | `AuthnOutput`   |

## Findings produced by this agent

Every finding emitted by the agent must use the trust-model vocabulary. **Invoke the `write-finding` skill when drafting any finding** — do not freelance the language.

## Before you finish — checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] At least 3 tests: one happy-path, one error-path, one boundary case
- [ ] No `any`, no `!` non-null assertions
- [ ] All errors are typed `Error` subclasses with descriptive names
- [ ] Agent reads inputs from `context.artifactDir` (or the `input` parameter), never from another agent's module
- [ ] Agent writes outputs as artifacts via `context.artifactDir`, never via shared mutable state
- [ ] All findings produced use the trust-model vocabulary (verified via the `write-finding` skill)
- [ ] TSDoc on the exported agent and on `I`/`O` types
- [ ] `.gitkeep` removed from the agent folder
- [ ] No `import` line in the agent points into a sibling `src/agents/*` folder
