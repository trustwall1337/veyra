---
name: new-scanner-adapter
description: Use when scaffolding a new scanner adapter under `src/scanners/` that wraps an external CLI tool (gitleaks, OSV-Scanner, semgrep). Enforces redaction, subprocess hygiene, JSON-only output parsing, and the read-only contract. Provides a template and a fixture pattern for tests that don't need the scanner installed. Do NOT use for editing the tool-runner agent or for non-scanner code.
---

# Skill: new-scanner-adapter

Scaffold a new scanner adapter following CLAUDE.md §Architecture, §Secrets, and PHASE_1_PLAN §7 Task 9.

## When to use

User asks to:

- "add a scanner adapter for [gitleaks | OSV-Scanner | semgrep | ...]"
- "wrap [tool] inside the tool-runner"
- "integrate [secret-scanning | dependency-scanning | static-analysis] tool"

Do NOT use when:

- editing the tool-runner agent itself (that's `new-agent` or normal edits)
- changing the scanner adapter contract (foundation change)
- adding a non-CLI scanner (e.g. an HTTP-API scanner — different pattern)

## The Phase 1 scanners

PHASE_1_PLAN §7 Task 9 calls for three:

1. **`gitleaks`** — secret scanning. **MUST run with `--redact`.**
2. **`osv`** (OSV-Scanner) — dependency vulnerabilities.
3. **`semgrep`** — custom rules for route/auth patterns (rules live under `rules/`).

Other scanners are out of scope for Phase 1.

## Hard rules — non-negotiable

### Redaction (CLAUDE.md §Secrets)

- Gitleaks (and any other secret-handling adapter) MUST pass `--redact` (or the equivalent flag) in its default args.
- The adapter MUST NEVER store, log, or report raw secret values.
- If the upstream scanner emits raw secrets despite `--redact`, the adapter MUST redact them in the parse step before persisting or returning them.

### Read-only

Adapters are read-only by contract:

- Only spawn the scanner as a subprocess against local paths.
- Never write to the project being scanned.
- Never pass scanner flags like `--fix`, `--apply`, `--commit`, `--add` — those flags are forbidden.

### Subprocess hygiene

- Use `node:child_process` `spawn` (NOT `exec` — `exec` passes args through a shell).
- Pass arguments as an array, not a single string.
- Set an explicit `timeout` (default: `60_000` ms; adjust per scanner).
- Capture **both** `stdout` and `stderr`.
- Handle non-zero exit codes explicitly — some scanners (gitleaks) exit non-zero when findings are present, which is a *successful* run, not a failure.
- Parse **JSON** output only — never regex-parse human-readable output. If a scanner has no JSON mode, that's a blocker; raise it to the user.

### Missing binary

If the scanner binary isn't installed, the adapter MUST:

- return `Result<_, ScannerNotInstalledError>` (typed error, not a thrown crash)
- include install instructions in the error message
- NOT block the orchestrator — the tool-runner agent will mark the relevant control as `coverage-gap`

## Files to create

- `src/scanners/<scanner-name>/<scanner-name>.ts` — adapter implementation
- `src/scanners/<scanner-name>/<scanner-name>.test.ts` — Vitest tests using fixture JSON
- `src/scanners/<scanner-name>/types.ts` — adapter input/output types and `<Name>Error` subtypes
- `src/scanners/<scanner-name>/fixtures/` — sample scanner output JSON files for tests:
  - one happy-path fixture (no findings)
  - one with-findings fixture (parseable, multiple finding types)
  - one malformed fixture (verifies graceful failure)

## Testing without the scanner installed

**Tests MUST NOT invoke the real scanner binary.** Reasons:

- CI doesn't have gitleaks / OSV / semgrep pre-installed.
- Real scanner output is non-deterministic (versions, environment).
- Real secrets accidentally placed in fixtures would violate the trust-model rules.

The template factors out the subprocess call as a `Runner` interface so tests can inject a fake. A sample fixture is at `examples/fixture-output.example.json`; copy and shape it to match the real scanner's output.

## Templates

Start from `templates/scanner-adapter.template.ts`. Placeholder convention:

| Placeholder           | Replace with                              | Example      |
| --------------------- | ----------------------------------------- | ------------ |
| `PlaceholderScanner`  | PascalCase adapter name                   | `Gitleaks`   |
| `'placeholder-scanner'` | kebab-case adapter id (string literal)   | `'gitleaks'` |
| `'placeholder-binary'` | actual binary name on disk (string)      | `'gitleaks'` |

## Before you finish — checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Uses `spawn` (not `exec`), arguments passed as array, explicit `timeout`
- [ ] Secret-handling adapters include `--redact` (or equivalent) in default args
- [ ] No raw secret values touch any log line, file, or returned value — verify by reading the parse step
- [ ] Non-zero exit codes handled explicitly (findings-present vs. real failure distinguished)
- [ ] Missing binary returns `ScannerNotInstalledError`, never throws uncaught
- [ ] Malformed JSON returns `ScannerOutputParseError`, never throws uncaught
- [ ] At least one happy-path fixture test
- [ ] At least one with-findings fixture test (verifies parsing into typed evidence)
- [ ] At least one malformed-output fixture test (verifies graceful failure)
- [ ] No `any`, no `!` non-null assertions
- [ ] Errors are typed `Error` subclasses: `ScannerNotInstalledError`, `ScannerOutputParseError`, `ScannerExecutionError`
- [ ] No fixture file contains a real-looking secret — all secret-like strings are obviously fake (e.g. `'REDACTED'`, `'AKIA-EXAMPLE-XXXX'`)
