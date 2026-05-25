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

  CONTEXT_NO_CONTEXT_AVAILABLE:
    'No declared-context artifact was found for this scan.',

  EVIDENCE_NO_EVIDENCE_AVAILABLE:
    'No evidence-inventory artifact was found.',

  FINDINGS_NONE: 'No findings emitted by the deterministic baseline.',

  CONTROL_CARDS_NONE: 'No control cards were produced for this scan.',

  SUGGESTED_TESTS_NONE: 'No additional negative tests were suggested.',

  UNCERTAINTY_NOTES_NONE:
    'No uncertainty notes were emitted by the deterministic baseline.',

  SOURCES_HEADER: 'This section lists which scanners and connectors checked which controls.',

  MCP_DECLARED_NOT_VERIFIED:
    '(declared via MCP — not verified at runtime)',
  ACTIVE_VALIDATION_NOT_RUN:
    'Active validation tests were not run in this scan.',
  CLEANUP_PROOF_NOT_RUN:
    'Cleanup proof was not produced in this scan.',
} as const;
