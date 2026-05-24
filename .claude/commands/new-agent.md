---
description: Scaffold a new Veyra agent under src/agents/<name>/. Delegates to the `new-agent` skill.
argument-hint: <agent-name-in-kebab-case>
---

Scaffold a new agent named `$ARGUMENTS` under `src/agents/$ARGUMENTS/`.

Invoke the `new-agent` skill. The skill provides:

- the seven valid Phase 1 agent names (stop if `$ARGUMENTS` doesn't match one)
- the `VeyraAgent<I, O>` contract
- the file checklist (`<name>.ts`, `<name>.test.ts`, `types.ts`)
- starter templates with placeholders
- the "before you finish" verification list

Do not duplicate the skill's rules inline — read them from the skill.
