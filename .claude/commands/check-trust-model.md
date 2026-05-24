---
description: Run the output-language-lint sub-agent against all user-facing strings in the repo. Use before any PR that changes reporters, CLI output, or README.
---

Delegate to the `output-language-lint` sub-agent. Scope of the scan:

- `src/reporters/` — report templates and report generators
- `src/cli/` — CLI output strings and error messages
- Any string under `src/` that reaches the user (errors thrown, log lines, AI prompts that mention the user's app)
- `README.md`
- `ONBOARDING.md`
- Any user-facing fixture string under `examples/` (the *vulnerable code itself* is exempt — only meta-text like fixture READMEs)

Pass these files explicitly to the sub-agent. Expect a `file:line — current — proposed — reasoning` table back, or a clean-pass statement.

If the agent reports violations, do not auto-fix them — surface them to the user with the proposed rewrites so they can decide. Trust-model phrasing is intentional and shouldn't be changed silently.
