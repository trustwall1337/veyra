/**
 * Phase 2 reporter sections (step 2.12).
 *
 * Renders: active-validation outcomes, cleanup proof, AI explanations.
 * Each section honours CLAUDE.md §Output language: only "checked",
 * "found", "missing", "appears launch-blocking", "needs human review",
 * "negative tests should be added" — never "secure"/"safe"/"compliant".
 *
 * Sections are pure functions over Phase 2 artifact shapes; they
 * accept undefined inputs and render the "no data" branch rather
 * than throwing.
 */

import type { ActiveValidationResult } from '../../../types/scan-plan.js';
import type { CleanupProof } from '../../../agents/synthetic-data-manager/agent.js';
import type { AiEnrichment } from '../../../agents/ai-explainer/agent.js';
import { STRINGS } from '../strings.js';

export interface Phase2SectionInputs {
  readonly activeValidationResults?: readonly ActiveValidationResult[];
  readonly cleanupProof?: CleanupProof;
  readonly aiEnrichments?: readonly AiEnrichment[];
  readonly aiDisabled?: boolean;
  /** Minimum confidence at which AI enrichments render in the main body. */
  readonly aiConcernThreshold?: 'low' | 'medium' | 'high';
}

export function renderActiveValidationSection(
  inputs: Phase2SectionInputs,
): string {
  const lines: string[] = [STRINGS.HEADING_ACTIVE_VALIDATION, ''];
  const results = inputs.activeValidationResults;
  if (results === undefined || results.length === 0) {
    lines.push(STRINGS.ACTIVE_VALIDATION_NONE_RUN);
    return lines.join('\n');
  }
  // Group by outcome for legibility.
  const byOutcome = new Map<string, ActiveValidationResult[]>();
  for (const r of results) {
    const list = byOutcome.get(r.outcome) ?? [];
    list.push(r);
    byOutcome.set(r.outcome, list);
  }
  for (const outcome of ['proven_allowed', 'proven_denial', 'inconclusive'] as const) {
    const subset = byOutcome.get(outcome) ?? [];
    if (subset.length === 0) continue;
    lines.push(`### ${outcome} (${String(subset.length)})`);
    lines.push('');
    for (const r of subset) {
      lines.push(`- \`${r.test_id}\` — control \`${r.control_id}\`, duration ${String(r.duration_ms)}ms`);
    }
    lines.push('');
  }
  if ((byOutcome.get('inconclusive') ?? []).length > 0) {
    lines.push(STRINGS.ACTIVE_VALIDATION_INCONCLUSIVE_NOTE);
  }
  return lines.join('\n');
}

export function renderCleanupProofSection(inputs: Phase2SectionInputs): string {
  const lines: string[] = [STRINGS.HEADING_CLEANUP_PROOF, ''];
  const proof = inputs.cleanupProof;
  if (proof === undefined) {
    lines.push('No cleanup proof was produced in this scan (Mode A / no synthetic data created).');
    return lines.join('\n');
  }
  if (proof.residual_count === 0) {
    lines.push(STRINGS.CLEANUP_PROOF_RESIDUAL_ZERO);
  } else {
    lines.push(`${STRINGS.CLEANUP_PROOF_RESIDUAL_NONZERO_PREFIX} ${String(proof.residual_count)}.`);
    lines.push('This appears launch-blocking and needs human review.');
  }
  lines.push('');
  lines.push(`- created: ${String(proof.created_count)}`);
  lines.push(`- deleted: ${String(proof.deleted_count)}`);
  lines.push(`- residual: ${String(proof.residual_count)}`);
  lines.push(`- duration_ms: ${String(proof.duration_ms)}`);
  return lines.join('\n');
}

const CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function renderAiExplanationsSection(
  inputs: Phase2SectionInputs,
): string {
  const lines: string[] = [STRINGS.HEADING_AI_EXPLANATIONS, ''];
  if (inputs.aiDisabled === true) {
    lines.push(STRINGS.AI_EXPLANATIONS_DISABLED_NOTE);
    return lines.join('\n');
  }
  const enrichments = inputs.aiEnrichments;
  if (enrichments === undefined || enrichments.length === 0) {
    lines.push('No AI explanations were produced for this scan.');
    return lines.join('\n');
  }
  const threshold = inputs.aiConcernThreshold ?? 'medium';
  const minRank = CONFIDENCE_RANK[threshold];
  const above: AiEnrichment[] = [];
  const below: AiEnrichment[] = [];
  for (const e of enrichments) {
    if (CONFIDENCE_RANK[e.confidence] >= minRank) above.push(e);
    else below.push(e);
  }
  for (const e of above) {
    lines.push(`### ${e.control_id} (confidence: ${e.confidence})`);
    lines.push('');
    lines.push(e.explanation);
    if (e.suggested_tests_refined.length > 0) {
      lines.push('');
      lines.push('Negative tests should be added:');
      for (const t of e.suggested_tests_refined) lines.push(`- ${t}`);
    }
    if (e.uncertainty_notes.length > 0) {
      lines.push('');
      lines.push(`Uncertainty: ${e.uncertainty_notes}`);
    }
    lines.push('');
  }
  // Codex retro 2.12-below-threshold-ai-still-rendered: per the
  // single-visibility-control contract, entries below the threshold
  // are NOT rendered in the human-facing report body. They remain in
  // ai-enrichments.json for audit. The reporter notes the count of
  // suppressed entries so the customer can lower the threshold to
  // surface them.
  if (below.length > 0) {
    lines.push('');
    lines.push(
      `${String(below.length)} additional AI suggestion(s) at confidence below \`${threshold}\` were recorded in \`ai-enrichments.json\` for audit but are not rendered here. Lower \`--ai-concern-threshold\` to surface them.`,
    );
  }
  return lines.join('\n');
}
