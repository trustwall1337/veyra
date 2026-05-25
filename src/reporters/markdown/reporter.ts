/**
 * Markdown reporter — pure function from `ReadinessReport` to markdown.
 *
 * Per step 13 Guardrails: same input → same byte output. No disk reads,
 * no network. The reporter owns no agent logic.
 */

import type { AIConcern } from '../../types/ai-concern.js';
import type { Finding } from '../../types/finding.js';
import type { ReadinessReport } from '../../types/readiness-report.js';

import { renderActiveOutcomesSection } from './sections/active-outcomes.js';
import {
  renderAiConcernsOmittedSection,
  renderAiConcernsSection,
  type AiConcernThreshold,
} from './sections/ai-concerns.js';
import { STRINGS } from './strings.js';

export interface MarkdownReportOptions {
  /**
   * AIConcern entries produced by Pass-2 disposition (revision §11
   * tier 2). When `undefined`, the report assumes AI was disabled and
   * renders the omitted-section banner instead.
   */
  readonly aiConcerns?: readonly AIConcern[];
  /**
   * Minimum AIConcern confidence to render. Default `medium` per
   * revision §14 Q6.
   */
  readonly aiConcernThreshold?: AiConcernThreshold;
}

function renderFinding(f: Finding): string {
  const parts = [
    `### ${f.title}`,
    '',
    `- control: \`${f.control_id}\``,
    `- finding_type: \`${f.finding_type}\``,
    `- evidence_strength: \`${f.evidence_strength}\``,
    `- review_action: \`${f.review_action}\``,
    `- blast_radius: \`${f.blast_radius}\``,
    '',
    f.summary,
  ];
  if (f.evidence_refs.length > 0) {
    parts.push('', `evidence_refs: ${f.evidence_refs.map((r) => `\`${r}\``).join(', ')}`);
  }
  if (f.suggested_test_ids !== undefined && f.suggested_test_ids.length > 0) {
    parts.push('', `Negative tests should be added: ${f.suggested_test_ids.map((id) => `\`${id}\``).join('; ')}`);
  }
  return parts.join('\n');
}

function renderExecutiveSummary(report: ReadinessReport): string {
  const lines: string[] = [
    STRINGS.HEADING_EXECUTIVE_SUMMARY,
    '',
    `- project: \`${report.project_name}\``,
    `- scan_id: \`${report.scan_id}\``,
    `- generated_at: \`${report.generated_at}\``,
    `- veyra_version: \`${report.veyra_version}\``,
    `- total_controls: ${String(report.readiness_summary.total_controls)}`,
    `- evidence_present: ${String(report.readiness_summary.evidence_present)}`,
    `- needs_review: ${String(report.readiness_summary.needs_review)}`,
    `- launch_blockers: ${String(report.readiness_summary.launch_blocker)}`,
  ];
  return lines.join('\n');
}

function renderLaunchBlockers(report: ReadinessReport): string {
  if (report.launch_blockers.length === 0) {
    return `${STRINGS.HEADING_LAUNCH_BLOCKERS}\n\n${STRINGS.SUMMARY_NO_BLOCKERS}`;
  }
  const sections = [STRINGS.HEADING_LAUNCH_BLOCKERS, '', STRINGS.SUMMARY_BLOCKERS_PREFIX, ''];
  for (const f of report.launch_blockers) {
    sections.push(renderFinding(f));
    sections.push('');
  }
  return sections.join('\n').trim();
}

function renderControlCards(report: ReadinessReport): string {
  if (report.control_cards.length === 0) {
    return `${STRINGS.HEADING_CONTROL_CARDS}\n\n${STRINGS.CONTROL_CARDS_NONE}`;
  }
  const sections = [STRINGS.HEADING_CONTROL_CARDS, ''];
  for (const card of report.control_cards) {
    sections.push(`### ${card.control_id}: ${card.title}`);
    sections.push('');
    sections.push(`- readiness_status: \`${card.readiness_status}\``);
    sections.push(`- findings: ${String(card.findings.length)}`);
    sections.push(`- evidence_items: ${String(card.evidence.length)}`);
    sections.push(`- suggested_tests: ${String(card.suggested_tests.length)}`);
    sections.push('');
  }
  return sections.join('\n').trim();
}

export function renderMarkdownReport(
  report: ReadinessReport,
  options: MarkdownReportOptions = {},
): string {
  const threshold = options.aiConcernThreshold ?? 'medium';
  const tier2 =
    options.aiConcerns === undefined
      ? renderAiConcernsOmittedSection()
      : renderAiConcernsSection(options.aiConcerns, threshold);
  const sections: string[] = [
    `# Veyra launch-readiness report`,
    '',
    renderExecutiveSummary(report),
    '',
    renderLaunchBlockers(report),
    '',
    tier2,
    '',
    renderActiveOutcomesSection(),
    '',
    renderControlCards(report),
    '',
    STRINGS.HEADING_SOURCES,
    '',
    STRINGS.SOURCES_HEADER,
  ];
  return sections.join('\n').trimEnd() + '\n';
}
