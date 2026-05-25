/**
 * Tier 2 of the three-tier report: AI-suggested areas for human review.
 *
 * Per revision §11 + §14 Q6: AIConcern entries at or above the
 * configured `--ai-concern-threshold` render under this section.
 * Entries below threshold stay in the audit artifact but do not
 * render. Default threshold is `medium`. Single flag — no separate
 * hide-low control.
 *
 * AIConcerns NEVER appear under tier 1 (Findings) and NEVER affect
 * `readiness_status`.
 */

import type { AIConcern } from '../../../types/ai-concern.js';

export type AiConcernThreshold = 'low' | 'medium' | 'high';

const RANK: Readonly<Record<AiConcernThreshold, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

function passesThreshold(
  concern: AIConcern,
  threshold: AiConcernThreshold,
): boolean {
  return RANK[concern.confidence] >= RANK[threshold];
}

export const AI_CONCERNS_HEADING =
  '## AI-suggested areas for human review';

export function renderAiConcernsSection(
  concerns: readonly AIConcern[],
  threshold: AiConcernThreshold,
): string {
  if (concerns.length === 0) {
    return `${AI_CONCERNS_HEADING}\n\nNo AI concerns were produced for this scan.`;
  }
  const filtered = concerns.filter((c) => passesThreshold(c, threshold));
  if (filtered.length === 0) {
    return `${AI_CONCERNS_HEADING}\n\nAll AI concerns are below the threshold "${threshold}"; see the AIConcerns artifact for the full audit list.`;
  }
  const lines: string[] = [AI_CONCERNS_HEADING, ''];
  for (const c of filtered) {
    lines.push(`### concern ${c.concern_id}`);
    lines.push('');
    lines.push(`- category: \`${c.category}\``);
    lines.push(`- confidence: \`${c.confidence}\``);
    lines.push(`- originating_hypothesis_id: \`${c.originating_hypothesis_id}\``);
    lines.push(`- model_id: \`${c.model_id}\``);
    lines.push('');
    lines.push(c.reasoning);
    if (c.uncertainty_notes.length > 0) {
      lines.push('');
      lines.push(`Uncertainty: ${c.uncertainty_notes}`);
    }
    if (c.suggested_human_review.length > 0) {
      lines.push('');
      lines.push(`Suggested human review: ${c.suggested_human_review}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderAiConcernsOmittedSection(): string {
  return `${AI_CONCERNS_HEADING}\n\nAI was disabled for this scan (--no-ai or no provider configured). AIConcerns were not produced.`;
}
