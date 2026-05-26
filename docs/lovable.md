# Lovable in Veyra Phase 1

## Reading Lovable code

In Phase 1, Veyra reads code from the local filesystem. To scan a
Lovable-built application:

1. Open your Lovable project in the Lovable app.
2. Use the "GitHub" / "Connect to GitHub" feature to push your project
   to a GitHub repository.
3. `git clone` that repository to a local directory.
4. Run `pnpm dev -- scan --project <path-to-clone> --supabase <project_ref>`.

Veyra reads from the local clone; nothing in the customer's code is
uploaded to a remote scanner. The scan stays local.

## Why not "just connect to Lovable"?

Lovable's MCP server uses OAuth from inside the calling MCP client
only. There is no static personal-access-token (PAT) equivalent that
Veyra could use to authenticate, the way `SUPABASE_ACCESS_TOKEN` does
for Supabase.

Implementing a full OAuth client is deferred to Phase 1 step 28. Until
that lands, `--lovable-mcp` rejects at parse-time with the
step-28-deferred message; the flag is documented but not functional.

## What's checked, what isn't

Veyra checks the same controls regardless of whether the code came
from Lovable or any other source — controls are code-shape checks, not
provider-specific. The `--project` path is the input.

What needs human review when reading Lovable code from a local clone:

- Whether the local clone is the same revision your Lovable app is
  currently running. Veyra has no way to verify this; the customer
  vouches for it.
- Whether the Supabase project referenced in the code matches the
  Supabase project_ref you pass to `--supabase`. A mismatched ref
  reads metadata from the wrong project.

## Roadmap

- **Phase 1 step 28a (landed 2026-05-26):** the local-clone file-walk
  was extracted into a registered `lovable-github-clone` `CodeSource`
  under `src/data-sources/lovable-github-clone/`. Behavior is
  unchanged for customers; the seam is now shared with the future
  OAuth-backed `lovable-mcp` `CodeSource`.
- **Phase 1 step 28b (deferred, pending pre-coding probe):** Veyra
  implements an OAuth client capable of authenticating against
  Lovable's MCP server. This would let Veyra read code directly from
  Lovable without the GitHub-clone step. 28b is blocked until the
  three pre-coding facts (endpoint URL, client registration approach,
  scope) are recorded in `phases/phase-1/decisions.md` per the step
  file's "Pre-coding facts that need locking" requirement.
- **Phase 2:** active-validation work continues to read code via the
  same `CodeSource` capability interface that step 27 introduces; the
  Lovable code source is one implementation, GitHub-clone today.

This page is the source of truth for what works today. Marketing
language that goes beyond "reads from a local git clone of your
Lovable project" should not be used until step 28b ships.
