/**
 * All user-facing strings rendered by the Markdown reporter.
 *
 * Vocabulary is constrained to PHASE_1_PLAN §9: "checked", "found",
 * "missing", "appears launch-blocking", "needs human review", "negative
 * tests should be added". Forbidden: "secure", "safe", "compliant".
 *
 * Centralising the strings in one module makes `output-language-lint`
 * a one-file scan.
 */

export const STRINGS = {
  HEADING_EXECUTIVE_SUMMARY: '## Executive summary',
  HEADING_DECLARED_CONTEXT: '## Declared project context',
  HEADING_OBSERVED_EVIDENCE: '## Observed evidence',
  HEADING_LAUNCH_BLOCKERS: '## Items that appear launch-blocking',
  HEADING_FINDINGS: '## Findings',
  HEADING_CONTROL_CARDS: '## Control cards',
  HEADING_SUGGESTED_TESTS: '## Negative tests to add',
  HEADING_UNCERTAINTY_NOTES: '## Uncertainty notes',
  HEADING_SOURCES: '## Sources and scanner metadata',

  SUMMARY_NO_BLOCKERS:
    'No items appear launch-blocking in this scan. Heuristic findings still need human review.',
  SUMMARY_BLOCKERS_PREFIX:
    'The following items appear launch-blocking and need human review:',

  EVIDENCE_PRESENT_PHASE2_NOTE:
    '> `evidence_present` is populated by Phase 2 active validation. In Phase 1 the deterministic baseline only emits negative findings (likely / coverage_gap / confirmed); a 0 here reflects that, not a defect of the scan.',

  CONTEXT_NO_CONTEXT_AVAILABLE:
    'No declared-context artifact was found for this scan.',

  CONTEXT_DECLARED_INTENT_EMPTY:
    'declared-context.json loaded; declared_intent is empty (no AI inference ran and no deterministic fallback hints were available).',

  EVIDENCE_NO_EVIDENCE_AVAILABLE:
    'No evidence-inventory artifact was found.',

  FINDINGS_NONE: 'No findings emitted by the deterministic baseline.',

  CONTROL_CARDS_NONE: 'No control cards were produced for this scan.',

  SUGGESTED_TESTS_NONE: 'No additional negative tests were suggested.',

  UNCERTAINTY_NOTES_NONE:
    'No uncertainty notes were emitted by the deterministic baseline.',

  SOURCES_HEADER: 'This section lists which scanners and connectors checked which controls.',

  SOURCES_AI_DISABLED:
    'AI was disabled for this scan; AIConcerns not produced.',
  SOURCES_AI_USAGE_PREFIX: 'AI usage:',

  // Step 24: schema-source note in the Sources section. The deterministic
  // baseline reads Supabase schema from either a local `schema.sql`
  // dump (`--supabase-schema <path>`) or a live MCP project_ref
  // (`--supabase-mcp <ref>`). When both flags are supplied, MCP wins
  // and the note names the override decision.
  SOURCES_SCHEMA_SOURCE_SQL_FILE:
    'Supabase schema source: local SQL file. Tables and policies were checked against the dumped schema.',
  SOURCES_SCHEMA_SOURCE_MCP:
    'Supabase schema source: live MCP project_ref. Tables and policies were checked against read-only MCP calls (read_only=true + project_ref enforced per call).',
  SOURCES_SCHEMA_SOURCE_MCP_OVERRIDING_SQL_FILE:
    'Supabase schema source: live MCP project_ref (overriding the local SQL file). Both flags were supplied; the MCP read takes precedence per the step-24 conflict rule.',
  SOURCES_SCHEMA_SOURCE_REST:
    'Supabase schema source: Supabase Management REST API. Tables and storage configuration were checked against the documented v1 endpoints (database/openapi, storage/buckets, config/storage). RLS policy expressions are not exposed via REST; policy-level findings need human review.',

  MCP_DECLARED_NOT_VERIFIED:
    '(declared via MCP — not verified at runtime)',
  ACTIVE_VALIDATION_NOT_RUN:
    'Active validation tests were not run in this scan.',
  CLEANUP_PROOF_NOT_RUN:
    'Cleanup proof was not produced in this scan.',
} as const;
