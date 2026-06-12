/**
 * Checked-in narrative templates (Phase 3 / Step 36). Keyed by
 * `${claim_type}|${predicate_kind}`. Templates are written in the allowed
 * output-language vocabulary (CLAUDE.md §Output language + PHASE_1_PLAN §9):
 * `checked / found / missing / appears launch-blocking / needs human review /
 * negative tests should be added`. NEVER `secure / safe / compliant`.
 *
 * Placeholders are `{param}`; the renderer substitutes from the claim's
 * `template_params`. Missing required params → linter rejects.
 */

export interface NarrativeTemplate {
  readonly template: string;
  readonly required_params: readonly string[];
}

export const NARRATIVE_TEMPLATES: Readonly<Record<string, NarrativeTemplate>> =
  {
    'baseline_unmet|coverage_gap': {
      template:
        'Required evidence for {baseline_item_id} was not found; this control needs human review.',
      required_params: ['baseline_item_id'],
    },
    'likely_issue|rls_disabled': {
      template:
        'Row-level security appears missing on table {table}; this appears launch-blocking and needs human review.',
      required_params: ['table'],
    },
    'likely_issue|privileged_key': {
      template:
        'A privileged client key appears in checked code at {location}; this appears launch-blocking and needs human review. Negative tests should be added.',
      required_params: ['location'],
    },
    'informational|tool_succeeded': {
      template:
        'The {tool_id} tool ran and its result was checked.',
      required_params: ['tool_id'],
    },
  } as const;

/** Return the template for a (claim_type, predicate_kind) pair, or undefined. */
export function lookupTemplate(
  claim_type: string,
  predicate_kind: string,
): NarrativeTemplate | undefined {
  return NARRATIVE_TEMPLATES[`${claim_type}|${predicate_kind}`];
}
