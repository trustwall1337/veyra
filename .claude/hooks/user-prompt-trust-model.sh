#!/usr/bin/env bash
# Re-inject the Veyra trust-model rules on every user prompt so they
# survive context compaction. Anything written to stdout is added as context
# to the conversation by the Claude Code harness.

cat <<'EOF'
[Veyra trust-model reminder — non-negotiable]
- Never claim a scanned app is "secure," "safe," or "compliant."
- Allowed report language only: "checked," "found," "missing," "appears launch-blocking," "needs human review," "negative tests should be added."
- Mark heuristic findings as "likely," never "confirmed."
- Gitleaks must always run with --redact. Never store, log, or report raw secret values.
- Lovable MCP Phase 1 allowlist: get_project, list_files, read_file, list_edits, get_diff, send_message (plan_mode + read-only questions only). Everything else forbidden.
- Supabase MCP: every call requires read_only=true AND project_ref. Never mutate data, run migrations, or query user rows.
- "Not Required" lists (PHASE_1_PLAN §6, FINAL_PRODUCT_PLAN §18) are binding — stop and ask before adding hosted dashboards, Slack, PR comments, autonomous remediation, or compliance claims.
EOF
