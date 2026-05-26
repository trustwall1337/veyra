# Step 28 — Lovable OAuth client, Lovable code-fetch CodeSource, and the local-git-clone CodeSource that step 27 promised

**Status:** 28a done (2026-05-26); 28b deferred (blocked on Lovable endpoint/DCR/scope pre-coding probe)
**Maps to:** none of the planned sections directly — promised by step 27's parse-time-reject message (`--lovable-mcp requires a Lovable OAuth client; this is deferred to Phase 1 step 28`). Also closes a step-27 commitment gap: step 27 described a `src/data-sources/lovable-github-clone/` CodeSource that was NOT actually created (file-walk still lives inline in the bootstrap-inventory composer). Step 28 lands both: the OAuth-backed Lovable MCP `CodeSource` AND the local-git-clone `CodeSource` extracted from the bootstrap composer.
**Amends Phase 1 step:** 15 (Lovable MCP connector contract — layered on, not rewritten; keeps existing allowlist/tests; replaces only the stale transport/auth assumptions per codex Q8); 27 (creates the local-git-clone CodeSource step 27 claimed existed; replaces the `--lovable-mcp` parse-time-reject behaviour with a real implementation once feature-complete).
**Amends CLAUDE.md:** No new amendments. The Lovable MCP allowlist (`get_project`, `list_files`, `read_file`, `list_edits`, `get_diff`, `send_message` with plan_mode + fixed templates only) is binding. This step implements against that allowlist; it does not widen it.
**Produces:** (a) OAuth-2.0-Authorization-Code-with-PKCE client at `src/auth/lovable-oauth/`; (b) two `CodeSource` implementations: `src/data-sources/lovable-github-clone/` (extracted from `src/agents/product-understanding/inventory/bootstrap.ts`) and `src/data-sources/lovable-mcp/` (OAuth-backed); (c) one new `DataSourceErrorKind`: `'plan_not_available'` added to the existing union; (d) customer-facing CLI flag `--lovable <project_id>`; (e) token storage at `~/.config/veyra/lovable-credentials.json` (`0600` mode, parent dir `0700`); (f) plan-tier-gated error UX; (g) `phases/phase-1/decisions.md` entry recording OAuth-flow + endpoint + scope choices and the recorded-from-Lovable confirmation that `https://mcp.lovable.dev/mcp` (or whichever path) is the live endpoint; (h) recorded-from-real MCP fixtures for the three invoked tools; (i) live integration test gated on `VEYRA_LIVE_TESTS=1 + LOVABLE_OAUTH_REFRESH_TOKEN + LOVABLE_PROJECT_ID`.
**Depends on:** 15 (Lovable MCP connector — layered, not rewritten), 27 (CodeSource interface, capability-shaped artifacts, dev/customer flag separation), Phase 2 step 01 preventer decisions 7–10 (live-endpoint smoke test discipline).
**Executed by:** plain coding pass + `mcp-policy-check` subagent (verifies allowlist + scope claims) + `step-reviewer` subagent at the end + a live OAuth smoke test against a real Pro/Business-tier Lovable project.
**Verification:** `pnpm test --run` exits 0 (full suite + new assertions; current baseline 564 tests stays green). With `LOVABLE_OAUTH_REFRESH_TOKEN` + `LOVABLE_PROJECT_ID` env vars set, `pnpm dev -- scan --project <empty-dir> --lovable <project_id>` opens the browser once, completes OAuth at the loopback callback, persists the refresh token, fetches the project's files via Lovable MCP, writes `code-evidence.json` capability-shaped artifact, and produces real findings on cc-11-1 through cc-11-11 against the fetched code. On a Free-tier project the same command produces a `coverage_gap` finding on each code-driven control with a `plan_not_available` error kind, a sanitized Lovable error code/status, and the local-git-clone fallback recipe — no silent failure.

## Why now

Step 27 closed the customer-facing surface honestly: `--lovable-mcp` rejects at parse time and `docs/lovable.md` documents the local-git-clone fallback. That's a defensible Phase 1 floor, but it's still manual work the customer takes ("clone your Lovable project's GitHub repo, then run Veyra"). For Pro/Business Lovable customers — the highest-value segment for Veyra — step 28 removes that manual step.

Step 27 also claimed `src/data-sources/lovable-github-clone/` existed. It doesn't. Veyra's current file-walk happens inline in `src/agents/product-understanding/inventory/bootstrap.ts`, not through a registered `CodeSource`. The seam is right; the implementation half landed. Step 28 closes that gap by extracting the file-walk into a proper `lovable-github-clone` CodeSource. With both CodeSources sharing the interface, swapping between them is a registry lookup, not a code branch.

## Pre-coding facts that need locking (codex MUST-fix #1 and #3)

These are the recorded-from-real confirmations that codex called out as missing. They land in `phases/phase-1/decisions.md` BEFORE any code is written:

- **Lovable MCP endpoint URL.** Public Lovable docs (`docs.lovable.dev/integrations/lovable-mcp-server`) publish `https://mcp.lovable.dev`. Lovable's support reply on 2026-05-25 specified `https://mcp.lovable.dev/mcp` (Streamable HTTP, JSON-RPC). Decision: default to the public docs URL (`https://mcp.lovable.dev`) and run a live smoke test on the first OAuth flow to confirm. If the live test hits a 404 on `/`, fall back to `/mcp`. Whichever resolves, record the canonical URL in `decisions.md`.
- **OAuth client registration.** Public docs show a Cursor `CLIENT_ID` example. Do NOT reuse Cursor's client id. Decision: prefer Dynamic Client Registration (DCR) per RFC 7591 if Lovable supports it (verify on first OAuth flow); otherwise, request a Veyra-specific client id by mail/support and record the path. Either way, the client id ships in Veyra's source — it is public, not secret.
- **Authorization scope.** Public docs say connected clients get full-account access. Decision: request the narrowest documented scope if Lovable's authorization server exposes scope selection; otherwise request full-account scope and rely on Veyra's allowlist (`get_project + list_files + read_file` only — `list_edits`, `get_diff`, `send_message` are reachable but not invoked) as the enforcement boundary. Record both in `decisions.md`.

If any of the three confirmations fails on first contact (endpoint, DCR, scopes), the step is paused and surfaced to the user; we do NOT route around them with another workaround.

**Timing (codex SHOULD-consider #10).** "Recorded in `decisions.md` before coding" means recorded BEFORE the step's implementation is merged. A throwaway local spike (a one-shot manual OAuth probe, not committed) may be used to discover the endpoint URL, DCR availability, and scope behaviour. The spike code is not merged; the FINDINGS land in `decisions.md` before any persisted Veyra code starts using them.

## What lands

### Piece 1 — OAuth 2.0 Authorization Code + PKCE client (codex Q1, MUST-fix #2)

`src/auth/lovable-oauth/`:
- `oauth-client.ts` — issues authorization request, manages PKCE code verifier/challenge, validates `state` round-trip, exchanges authorization code for tokens, verifies exact redirect URI on return.
- `callback-server.ts` — minimal local-loopback HTTP server bound to `127.0.0.1:<ephemeral-port>` (IP literal, per RFC 8252 — NOT `localhost`). Optionally `[::1]:<port>` if IPv4 unavailable. Listens on `/callback`, closes immediately after the redirect arrives. Rejects any request whose `state` doesn't match.
- `token-store.ts` — persists the refresh token to `~/.config/veyra/lovable-credentials.json`. File mode `0600`, parent directory `~/.config/veyra/` mode `0700`. On Windows, sets the equivalent ACL (current-user read/write, no inheritance). Refuses to create the credential dir if it resolves under any `--project` path or output path. If file mode is wider than `0600` when read, reject the file and require re-auth.

Per codex MUST-fix #2 (RFC 8252): redirect URI is `http://127.0.0.1:<port>/callback`; PKCE code-challenge method is `S256`; the `state` parameter is a cryptographically random 32-byte value, verified on return. The HTTP listener is closed immediately after receiving the callback (no lingering open socket).

Per codex SHOULD-consider #6: redaction covers access tokens, refresh tokens, **AND** authorization codes. The auth code is short-lived but is still a credential during the exchange window; never logged.

Per CLAUDE.md `§Secrets`: tokens never appear on argv, in `scan-actions.log`, in artifacts, in error messages, or in AI prompts. The credential-store file path is configurable via `VEYRA_CREDENTIAL_DIR`; default `~/.config/veyra/` (macOS/Linux), `%APPDATA%/Veyra/` (Windows).

### Piece 2 — `lovable-github-clone` CodeSource (closing step 27's gap)

`src/data-sources/lovable-github-clone/`:
- `code-source.ts` — implements the existing `CodeSource` interface from `src/types/data-sources.ts`. Capability-gated on `read_code` (codex MUST-fix #4: NOT `read_code_content`).
- `walk()` returns a `FileWalkResult` from the on-disk directory under `--project`. Logic extracted verbatim from `src/agents/product-understanding/inventory/bootstrap.ts` (current inline file-walk); the bootstrap composer is updated to consume the registered `CodeSource` instead of walking inline.
- `readFile(path)` reads from disk via Node `fs.promises.readFile`.

This piece is non-controversial — it is purely a refactor moving inline logic behind the existing seam. It is required because step 28's `lovable-mcp` CodeSource cannot be the only registered `CodeSource` (Phase 1 must continue to support Free-tier and offline scans via local clone).

### Piece 3 — `lovable-mcp` CodeSource (OAuth-backed) (codex MUST-fix #4 + Q3 + Q5)

`src/data-sources/lovable-mcp/`:
- `code-source.ts` — implements `CodeSource`. Capability-gated on `read_code` (per the existing union in `src/types/data-sources.ts`).
- Connects to the Lovable MCP endpoint over Streamable HTTP via `@modelcontextprotocol/sdk`. **No subprocess spawn** — Lovable MCP is HTTP-based, not stdio-based.
- `walk()` invokes the Lovable MCP `list_files` tool; converts the result into `FileWalkResult`. If `list_files` omits file sizes, the converter computes them by reading each file's content size (codex SHOULD-consider #5).
- `readFile(path)` invokes the Lovable MCP `read_file` tool.
- `get_project` is NOT mapped onto `CodeSource` (codex SHOULD-consider #5). It is invoked separately by the declared-context composer (Phase 1 step 17c) for project metadata; the new method on the `lovable-mcp` module is `fetchProjectMetadata()` and its output flows into the existing declared-context build path.
- **Construction ordering (codex MUST-fix #9): Lovable's `list_files` and `read_file` require a git ref (`latest_commit_sha` from `get_project`). The `lovable-mcp` `CodeSource` is therefore constructed with `{ project_id, latest_commit_sha }` returned by an earlier `fetchProjectMetadata()` call. The orchestrator's dependency wiring (Phase 1 step 18b's topo-sort) handles this: the declared-context composer runs before any agent that consumes a `CodeSource`, and the registered `CodeSource` factory receives the resolved ref. A test asserts `walk()` / `readFile()` calls on the Lovable MCP CodeSource carry the ref; calls without it are rejected at the source boundary, not at the Lovable HTTP boundary.**

Per codex Q3: refresh is lazy. On the first 401 from any Lovable MCP call, the client uses the refresh token to mint a new access token and retries the call once. On a second 401 with the new token, the credential file is deleted and the scan fails with an explicit "Lovable OAuth session expired; re-run with `--reauth`" error. `expires_at` is stored ONLY if Lovable returns it; otherwise, refresh-on-401 is the sole strategy.

### Piece 4 — `DataSourceErrorKind` extension + plan-tier UX (codex MUST-fix #4 + #7)

Extend `DataSourceErrorKind` in `src/types/data-sources.ts`:

```typescript
export type DataSourceErrorKind =
  | 'capability_denied'
  | 'transport_error'
  | 'parse_error'
  | 'capability_not_exposed'
  | 'plan_not_available';        // NEW — for Lovable Free-tier and any future tier-gated source
```

When Lovable MCP returns a plan-tier rejection, the `lovable-mcp` CodeSource returns `Result<_, DataSourceError>` with `kind: 'plan_not_available'`. The reporter renders this as a `coverage_gap` finding on every code-driven control (cc-11-1 through cc-11-11) with summary:

> "Lovable code reads via OAuth require a Pro or Business plan. This project's plan rejected `list_files` with status `<sanitized status>`, error code `<sanitized code>`. Run with `--project <path-to-local-clone>` instead (see `docs/lovable.md` for the local-clone path)."

Per codex SHOULD-consider #7: the sanitized status and error code are included for support diagnostics. **Raw response bodies and headers are never included.** The redactor strips anything that looks like a token or session identifier from the rendered string.

### Piece 5 — CLI surface: `--lovable <project_id>` (codex Q4 + step 27 precedent)

- New: `--lovable <project_id>` → uses the Lovable OAuth backend.
- Deprecated: `--lovable-mcp` → still rejects at parse-time; message now points at `--lovable` (no longer at "step 28"; step 28 is this one).
- `--reauth` → forces a fresh OAuth flow (deletes the credential file and re-runs the browser flow on next scan).
- Customer-facing help shows `--lovable` and `--reauth`. The `--auth-mode` flag is NOT introduced in this step (codex Q6 — device-code flow split to step 29).

### Piece 6 — Documentation

`docs/lovable.md` (created in step 27) gets a new section: "Reading Lovable code via OAuth (Pro/Business plans)." Documents:
- The one-time browser flow.
- Where the credential file lives.
- How to revoke: delete the file + revoke the OAuth grant in Lovable's Account → Connected Apps.
- The plan-tier requirement (Pro/Business; Free → use the local-clone fallback).
- The local-clone fallback (already documented from step 27).

`README.md` gets a one-paragraph update under "How to scan a Lovable project" mentioning both paths.

## Done when

A single fresh scan satisfies all of:

1. **OAuth flow** completes against a real Lovable Pro/Business project. `pnpm dev -- scan --project /tmp/empty --lovable <project_id>` opens the browser, customer signs in, authorization returns to `127.0.0.1:<port>/callback`, credential file lands at `~/.config/veyra/lovable-credentials.json` with mode `0600` and parent dir mode `0700`.
2. **Subsequent scans** do not re-prompt for OAuth until the refresh token's lifetime expires or `--reauth` is passed.
3. **`list_files` + `read_file`** populate a `code-evidence.json` capability-shaped artifact. The contents match what the Lovable UI shows for the same project (spot-check during the live smoke test).
4. **Scanners run** against the fetched files. Gitleaks, OSV, Semgrep see Lovable-sourced code; cc-11-1 through cc-11-11 produce real findings or honest `coverage_gap`s.
5. **Plan-tier rejection works.** On a Free-tier project, every code-driven control emits a `coverage_gap` with `kind: 'plan_not_available'`, sanitized status/error code, and the local-clone fallback recipe. No silent failure.
6. **`--lovable-mcp` deprecation message** points at `--lovable`, not "step 28."
7. **Allowlist enforced.** `mcp-policy-check` confirms only `get_project`, `list_files`, `read_file` are invoked from step 28 code. The other allowlisted tools are reachable through the connector but not called.
8. **Tokens never leak.** A `grep` over `scan-actions.log` + every artifact + every error message after a scan returns zero hits for refresh token, access token, AND authorization code values. Recorded fixtures redact at capture time.
9. **`lovable-github-clone` CodeSource works** as a non-OAuth alternative. `pnpm dev -- scan --project <local-clone>` (no `--lovable`) continues to function exactly as it does after step 27, and the bootstrap composer now consumes the registered CodeSource instead of walking inline.
10. **`--reauth` and credential-file deletion** both trigger a fresh browser-OAuth flow.
11. **Live integration test** runs in CI behind `VEYRA_LIVE_TESTS=1 + LOVABLE_OAUTH_REFRESH_TOKEN + LOVABLE_PROJECT_ID`. Snapshot mode runs always.
12. **`pnpm test --run` exits 0** with new tests; existing 564 stay green; step 27's gates do not regress.
13. **`phases/phase-1/decisions.md`** records the three pre-coding confirmations (endpoint URL, client registration approach, authorization scope) BEFORE any code lands.
14. **Token-store safety** verified: a test asserts the credential dir is rejected if it resolves under `--project` or any `--out` path; a test asserts file mode `0600` and parent dir `0700` after a successful OAuth flow.

## Out of scope (explicitly NOT done in this step)

- **Device-code flow** for SSH/CI environments (codex Q6) — split to step 29 unless Lovable confirms device-code grant support during the pre-coding decisions.
- Invoking `send_message`, `list_edits`, or `get_diff` from Phase 1 controls (allowlist permits; this step does not call them).
- Replacing the existing inline file-walk in `bootstrap.ts` for anything other than the Lovable code path. Other scanners still walk locally via the same `lovable-github-clone` CodeSource.
- OS keychain integration (codex Q2 — deferred; plaintext-on-disk-with-0600 + parent-dir-0700 is the Phase 1 floor).
- An OAuth flow for any other provider.
- A hosted credential-broker service. Per FPP §18 binding.
- Changes to controls catalog or finding shapes.
- Phase 2 active validation work.

## Guardrails

- Per CLAUDE.md `§Secrets`: refresh tokens, access tokens, AND authorization codes never appear on argv, in logs, in artifacts, in error messages, or in AI prompts. File-mode `0600` enforced on the credential store, `0700` on parent dir, Windows ACL equivalents enforced. Credential dir refuses to resolve under `--project` or `--out`.
- Per CLAUDE.md `§MCP discipline`: only the three documented invoked tools (`get_project`, `list_files`, `read_file`) are called from step-28 code. Adding new tools requires a planner-level decision.
- Per CLAUDE.md `§Output language`: customer-facing strings use only allowed claims. `output-language-lint` clean on every new string.
- Per CLAUDE.md `§Extensibility-first`: no closed `'oauth' | 'pat' | 'service-role'` discriminator in shared types. Auth method is a property of the `CodeSource` implementation. The new `'plan_not_available'` kind goes into the existing union; no parallel discriminator is created.
- Per CLAUDE.md `§Validation policy`: the Lovable CodeSources are capability-gated by `ValidationPolicy.allowed_actions.has('read_code')` per the existing union.
- Per `FPP §18 Not Required`: no hosted dashboard, no sign-up flow, no Slack, no PR comments. The OAuth flow is between the customer's browser and Lovable; Veyra mediates only at the local-loopback callback.
- Do NOT reuse another client's CLIENT_ID. Either DCR or a Veyra-specific client id.
- Do NOT introduce `--auth-mode` or device-code in this step. Split to step 29 if needed.
- Do NOT widen the Lovable allowlist as part of this step.
- Do NOT remove the local-git-clone path; it is the Free-tier fallback AND the offline-scan path.

## References

- The 2026-05-25 Lovable support reply (recorded in `decisions.md`) confirming OAuth-only auth and the MCP endpoint shape.
- `docs.lovable.dev/integrations/lovable-mcp-server` — public Lovable MCP docs (referenced by codex finding #1 for endpoint URL and client-id discovery).
- `phases/phase-1/steps/27-architectural-course-correction-rest-and-honest-paths.md` — step that introduced the `CodeSource` interface, committed to step 28 for OAuth, and claimed (incorrectly) that `lovable-github-clone/` existed. This step closes both gaps.
- `phases/phase-1/steps/15-connector-lovable-mcp.md` — original connector contract; this step layers OAuth on top, keeps the allowlist + existing tests, replaces only the stale transport/auth assumptions.
- `CLAUDE.md §MCP discipline` (Lovable allowlist) — binding; this step implements against it without widening.
- `CLAUDE.md §Secrets` — token-handling discipline; binding.
- `RFC 8252` — OAuth 2.0 for Native Apps; authoritative reference for the loopback PKCE flow.
- `RFC 7591` — Dynamic Client Registration; the registration path attempted first.
- `src/types/data-sources.ts` — `CodeSource` interface, `DataSourceErrorKind` union, `read_code` capability.
- `src/agents/product-understanding/inventory/bootstrap.ts` — the file-walk extracted into `lovable-github-clone/`.
