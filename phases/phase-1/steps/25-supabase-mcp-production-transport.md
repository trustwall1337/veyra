# Step 25 — Supabase MCP production transport implementation

**Status:** done (2026-05-26)
**Maps to:** none of the planned sections directly — surfaced by step 24's §6.5 codex review (finding step24-f1). Step 24 wired the CLI → agent-registration → supabase-rls → connector flow end-to-end, and proved the wiring via an injected mock transport that replays recorded Supabase MCP responses. But the production transport that talks to a real Supabase MCP server is currently a fail-closed Phase 1 stub (`src/connectors/supabase/transport.ts`). This step implements the real transport.
**Amends Phase 1 step:** none (no contract changes; this completes the deferred work codex step24-f1 named)
**Produces:** real `SupabaseTransport` implementation in `src/connectors/supabase/transport.ts`; optional live-integration test under a separate suite that is opt-in via `SUPABASE_ACCESS_TOKEN` env var.
**Depends on:** 16 (Supabase MCP connector + policy gate), 24 (CLI / agent-registration wiring).
**Executed by:** plain coding pass + `mcp-policy-check` subagent + `step-reviewer` subagent + at minimum a typecheck pass; a live-test pass is opt-in.
**Verification:** `pnpm typecheck` clean; the new transport unit tests pass against fixture HTTP responses; an optional live-integration test (skipped without `SUPABASE_ACCESS_TOKEN`) exercises `list_tables` against a real Supabase project and asserts `read_only=true + project_ref` is on the wire.

## Goal

The default Supabase MCP transport is currently a fail-closed stub. The Veyra CLI rejects `--supabase-mcp` at the scan boundary unless a test transport is injected, so customers cannot use the flag end-to-end. This step ships the production transport so `--supabase-mcp <project_ref>` actually drives real MCP calls against a customer's Supabase project. Per CLAUDE.md §Resolved engineering decisions, the implementation choice is between `@modelcontextprotocol/sdk` (with the documented stdio path against a local Supabase MCP server) and hand-rolled JSON-RPC over `fetch` against the remote endpoint. This step picks one (the cheaper of the two given current SDK ESM resolution status) and lands it.

## What lands

- `src/connectors/supabase/transport.ts` — real `SupabaseTransport` implementation. Either:
  - `@modelcontextprotocol/sdk`'s stdio transport against a locally-spawned `npx @supabase/mcp-server-supabase`, OR
  - hand-rolled JSON-RPC over `fetch` against the Supabase MCP HTTP endpoint, with the access token in the `Authorization: Bearer ...` header.
- `src/connectors/supabase/transport.test.ts` — unit tests covering request shape (every call carries `read_only=true + project_ref`), response parsing, error-mapping (auth failure → `coverage_gap`-shaped error, never a raw token in the message), and the connector policy gate's enforcement still rejecting denied tools.
- `src/cli/end-to-end-fixture.test.ts` (optional extension) — a live-integration `describe` block that is skipped when `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` are unset. When both are present, it runs against the real project and asserts the same shape the recorded-fixture test does.

## Done when

- `--supabase-mcp <ref>` with `SUPABASE_ACCESS_TOKEN` set in the shell actually issues real MCP calls and the report shows real findings.
- The connector policy gate's `read_only=true + project_ref` enforcement is preserved (verified by unit test).
- No `execute_sql` or other denied tool ever reaches the transport.
- The access token never appears in any artifact, log, AI prompt, or error message in raw form (CLAUDE.md §Secrets verified by a regression unit test).
- `pnpm typecheck` clean; full unit tests stay green; the step-24 e2e gate (mock transport) keeps passing.
- The scan-command's fail-closed rejection from step 24 is replaced with the working production path — `--supabase-mcp` no longer requires a test transport factory injection.

## Failure modes and what they mean

- **MCP SDK breaks at integration time** (CLAUDE.md mentioned ESM resolution issue #460). Fall back to hand-rolled JSON-RPC over `fetch` per the resolved decision. Document the fallback choice in step 25 itself for future readers.
- **Real Supabase MCP response shape differs from the recorded fixture.** Update the fixture; do NOT soften the test. The recorded-fixture path is the deterministic gate; live runs validate the production transport.
- **Token leaks into an error message.** Stop. Per CLAUDE.md §Secrets the token never reaches an artifact. Find the error-mapping site and add redaction before any further work.

## Guardrails

- Do NOT add any tool to the Phase 1 Supabase MCP allowlist. New tools require explicit Phase 2 decision.
- Do NOT call `execute_sql` even under `read_only=true`. Denied in Phase 1 per CLAUDE.md.
- Do NOT weaken the connector policy gate. The transport is the wire-level shim under the gate; the gate stays as-is.
- Do NOT make `pnpm test` depend on network access. The recorded-fixture e2e path stays the default. A live-integration test is opt-in via env vars and skipped without them.
- Per CLAUDE.md §Output language: any new error string ("MCP authentication failed", "project_ref required") goes through `output-language-lint`.

## References

- `phases/phase-1/steps/24-supabase-mcp-actually-wired.md` — the wiring step this completes.
- `phases/phase-1/steps/16-connector-supabase-mcp.md` — connector + policy contract.
- `src/connectors/supabase/transport.ts` — current fail-closed stub; this step replaces the body.
- `CLAUDE.md §Resolved engineering decisions` — the SDK-vs-fetch fallback path.
- `CLAUDE.md §MCP discipline`, §Secrets, §Output language — non-negotiable rules.
