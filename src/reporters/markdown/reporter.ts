/**
 * Markdown reporter — pure function from `ReadinessReport` to markdown.
 *
 * Per step 13 Guardrails: same input → same byte output. No disk reads,
 * no network. The reporter owns no agent logic.
 */

import { redactSecrets } from '../../ai/sanitization.js';
import type { AIConcern } from '../../types/ai-concern.js';
import type {
  DeclaredIntent,
  ObservedEvidence,
} from '../../types/declared-context.js';
import type { Finding } from '../../types/finding.js';
import type { ReadinessReport } from '../../types/readiness-report.js';

import { renderActiveOutcomesSection } from './sections/active-outcomes.js';
import {
  renderAiConcernsSection,
  type AiConcernThreshold,
} from './sections/ai-concerns.js';
import { STRINGS } from './strings.js';

export interface AiUsageSummary {
  readonly provider?: string;
  readonly model?: string;
  readonly call_count?: number;
  readonly cache_hit_ratio?: number;
}

export interface MarkdownReportOptions {
  /**
   * Declared project context loaded from `declared-context.json` (step
   * 17c) — when present, the report renders a bounded whitelist of
   * fields (purpose, user_roles, data_kinds, auth_model). Per step 21
   * Bug 2 + retro-15 f5 / retro-16 f8: every rendered string passes
   * through `redactSecrets` and list lengths are capped. When
   * `undefined`, the section keeps the pre-step-21 "see declared-context.json"
   * pointer text.
   */
  readonly declaredContext?: {
    readonly declared_intent?: DeclaredIntent;
  };
  /**
   * Observed evidence loaded from `inventory-bootstrap.json` (step 17b)
   * — same redact + cap discipline as `declaredContext`. When
   * `undefined`, the section keeps the "see inventory-bootstrap.json"
   * pointer text.
   */
  readonly observedEvidence?: ObservedEvidence;
  /**
   * AIConcern entries produced by Pass-2 disposition (revision §11
   * tier 2). When `undefined`, the AIConcerns tier is OMITTED from
   * the report entirely (per step 13b contract); Sources carries the
   * disabled-AI note instead.
   */
  readonly aiConcerns?: readonly AIConcern[];
  /**
   * Minimum AIConcern confidence to render. Default `medium` per
   * revision §14 Q6.
   */
  readonly aiConcernThreshold?: AiConcernThreshold;
  /**
   * AI usage summary for the Sources section (revision §11 +
   * step 13b). When present and `aiConcerns` is set, the Sources
   * section lists provider / model / call_count / cache_hit_ratio.
   * When `aiConcerns` is undefined, the Sources section carries the
   * `AI was disabled for this scan` note instead.
   */
  readonly aiUsage?: AiUsageSummary;
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
    '',
    // Step 23 Bug E: user-visible doc that the deterministic Phase 1
    // baseline does not promote controls to evidence_present; Phase 2
    // active validation does. Without this note a reader sees
    // `evidence_present: 0` and may read it as a scan defect.
    STRINGS.EVIDENCE_PRESENT_PHASE2_NOTE,
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

// Step 21 Bug 2: bounded, redacted rendering of declared-context +
// observed-evidence. Hardcoded caps below keep the report short even
// against pathological inputs (huge file_map / dep tree).
const MAX_ROUTES = 10;
const MAX_DEPS = 10;
const MAX_TABLES = 10;
const MAX_FILES = 10;
const MAX_ENV = 10;

/**
 * Step 21 retro f7: escape Markdown metacharacters that can change
 * report structure WHEN INTERPOLATED INTO PROSE. The narrow set
 * below targets the actual injection vectors (links, inline code,
 * literal escape sequences, asterisk emphasis, raw HTML/comparison
 * brackets) without mangling legitimate identifiers like
 * `tenant_member` (`_` is only an emphasis delimiter at word
 * boundaries, not inside identifiers), `demo-app` (`-` is only a
 * list marker at line start), or `cc-11-5` (`-` and digits).
 */
const MARKDOWN_META = /[\\`*\[\]()<>!]/g;

function escapeMarkdown(value: string): string {
  return value.replace(MARKDOWN_META, (m) => `\\${m}`);
}

function safe(value: string): string {
  return escapeMarkdown(redactSecrets(value) as string);
}

function renderConfidenceTag(c: 'low' | 'medium' | 'high'): string {
  return `(confidence: ${c})`;
}

function renderDeclaredContextSection(
  declared: NonNullable<MarkdownReportOptions['declaredContext']> | undefined,
): string {
  if (declared === undefined) {
    return `${STRINGS.HEADING_DECLARED_CONTEXT}\n\n${STRINGS.CONTEXT_NO_CONTEXT_AVAILABLE}\n\nSee \`declared-context.json\` for the full declared context (purpose, user_roles, data_kinds, auth_model) when AI is opted in.`;
  }
  const intent = declared.declared_intent;
  if (intent === undefined || Object.keys(intent).length === 0) {
    return `${STRINGS.HEADING_DECLARED_CONTEXT}\n\n${STRINGS.CONTEXT_DECLARED_INTENT_EMPTY}\n\nSee \`declared-context.json\` for raw artifact data.`;
  }
  const lines: string[] = [STRINGS.HEADING_DECLARED_CONTEXT, ''];
  if (intent.purpose !== undefined) {
    lines.push(
      `- purpose ${renderConfidenceTag(intent.purpose.confidence)}: ${safe(intent.purpose.value)}`,
    );
  }
  if (intent.user_roles !== undefined) {
    const values = intent.user_roles.value.slice(0, MAX_ROUTES).map(safe);
    lines.push(
      `- user_roles ${renderConfidenceTag(intent.user_roles.confidence)}: ${values.join(', ')}`,
    );
  }
  if (intent.data_kinds !== undefined) {
    const values = intent.data_kinds.value.slice(0, MAX_DEPS).map(safe);
    lines.push(
      `- data_kinds ${renderConfidenceTag(intent.data_kinds.confidence)}: ${values.join(', ')}`,
    );
  }
  if (intent.auth_model !== undefined) {
    lines.push(
      `- auth_model ${renderConfidenceTag(intent.auth_model.confidence)}: ${safe(intent.auth_model.value)}`,
    );
  }
  lines.push('', `Source: \`declared-context.json\`.`);
  return lines.join('\n');
}

function renderObservedEvidenceSection(
  evidence: ObservedEvidence | undefined,
): string {
  if (evidence === undefined) {
    return `${STRINGS.HEADING_OBSERVED_EVIDENCE}\n\n${STRINGS.EVIDENCE_NO_EVIDENCE_AVAILABLE}\n\nSee \`inventory-bootstrap.json\` (deterministic file/route/dep evidence) and \`scan-facts.json\` (scanner-emitted facts) for the full observed evidence set.`;
  }
  const lines: string[] = [STRINGS.HEADING_OBSERVED_EVIDENCE, ''];
  lines.push(`- framework: \`${safe(evidence.framework)}\``);
  if (evidence.package_json_digest !== undefined) {
    const pkg = evidence.package_json_digest;
    lines.push(`- project: \`${safe(pkg.name)}\``);
    const depNames = Object.keys(pkg.dependencies ?? {});
    if (depNames.length > 0) {
      const shown = depNames.slice(0, MAX_DEPS).map((d) => `\`${safe(d)}\``);
      const more =
        depNames.length > MAX_DEPS
          ? ` (+${String(depNames.length - MAX_DEPS)} more)`
          : '';
      lines.push(`- dependencies: ${shown.join(', ')}${more}`);
    }
  }
  if (evidence.routes.length > 0) {
    const shown = evidence.routes
      .slice(0, MAX_ROUTES)
      .map((r) => `\`${safe(r)}\``);
    const more =
      evidence.routes.length > MAX_ROUTES
        ? ` (+${String(evidence.routes.length - MAX_ROUTES)} more)`
        : '';
    lines.push(`- routes: ${shown.join(', ')}${more}`);
  }
  if (evidence.env_declarations.length > 0) {
    const shown = evidence.env_declarations
      .slice(0, MAX_ENV)
      .map((e) => `\`${safe(e)}\``);
    const more =
      evidence.env_declarations.length > MAX_ENV
        ? ` (+${String(evidence.env_declarations.length - MAX_ENV)} more)`
        : '';
    lines.push(`- env_declarations: ${shown.join(', ')}${more}`);
  }
  if (evidence.supabase_schema !== undefined) {
    const tables = evidence.supabase_schema.tables
      .slice(0, MAX_TABLES)
      .map((t) => `\`${safe(t)}\``);
    const more =
      evidence.supabase_schema.tables.length > MAX_TABLES
        ? ` (+${String(evidence.supabase_schema.tables.length - MAX_TABLES)} more)`
        : '';
    lines.push(`- supabase_tables: ${tables.join(', ')}${more}`);
  }
  if (evidence.file_map.length > 0) {
    const fileCount = evidence.file_map.length;
    lines.push(`- file_map: ${String(fileCount)} files indexed (first ${String(Math.min(MAX_FILES, fileCount))} shown below)`);
    for (const f of evidence.file_map.slice(0, MAX_FILES)) {
      lines.push(`  - \`${safe(f)}\``);
    }
  }
  lines.push(
    '',
    `Source: \`inventory-bootstrap.json\` + \`scan-facts.json\`.`,
  );
  return lines.join('\n');
}

function renderFindingsSection(report: ReadinessReport): string {
  const allFindings: Finding[] = [];
  for (const card of report.control_cards) {
    for (const f of card.findings) allFindings.push(f);
  }
  if (allFindings.length === 0) {
    return `${STRINGS.HEADING_FINDINGS}\n\n${STRINGS.FINDINGS_NONE}`;
  }
  const sections: string[] = [STRINGS.HEADING_FINDINGS, ''];
  for (const f of allFindings) {
    sections.push(renderFinding(f));
    sections.push('');
  }
  return sections.join('\n').trimEnd();
}

function renderSuggestedTestsSection(report: ReadinessReport): string {
  const allTestIds = new Set<string>();
  for (const card of report.control_cards) {
    for (const f of card.findings) {
      for (const t of f.suggested_test_ids ?? []) allTestIds.add(t);
    }
  }
  if (allTestIds.size === 0) {
    return `${STRINGS.HEADING_SUGGESTED_TESTS}\n\n${STRINGS.SUGGESTED_TESTS_NONE}`;
  }
  const lines: string[] = [STRINGS.HEADING_SUGGESTED_TESTS, ''];
  for (const t of Array.from(allTestIds).sort()) lines.push(`- ${t}`);
  return lines.join('\n');
}

function renderUncertaintyNotesSection(report: ReadinessReport): string {
  const allNotes = new Set<string>();
  for (const card of report.control_cards) {
    for (const n of card.uncertainty_notes) allNotes.add(n);
  }
  if (allNotes.size === 0) {
    return `${STRINGS.HEADING_UNCERTAINTY_NOTES}\n\n${STRINGS.UNCERTAINTY_NOTES_NONE}`;
  }
  const lines: string[] = [STRINGS.HEADING_UNCERTAINTY_NOTES, ''];
  for (const n of allNotes) lines.push(`- ${n}`);
  return lines.join('\n');
}

function renderSourcesSection(options: MarkdownReportOptions): string {
  const lines: string[] = [STRINGS.HEADING_SOURCES, '', STRINGS.SOURCES_HEADER];
  if (options.aiConcerns === undefined) {
    // --no-ai mode: tier 2 was omitted from the body; Sources carries
    // the disabled-AI note per step 13b contract.
    lines.push('', STRINGS.SOURCES_AI_DISABLED);
  } else {
    // AI was enabled. Render usage summary when supplied.
    const u = options.aiUsage;
    if (u !== undefined) {
      lines.push('', STRINGS.SOURCES_AI_USAGE_PREFIX);
      if (u.provider !== undefined) lines.push(`- provider: \`${u.provider}\``);
      if (u.model !== undefined) lines.push(`- model: \`${u.model}\``);
      if (u.call_count !== undefined) {
        lines.push(`- ai_call_count: ${String(u.call_count)}`);
      }
      if (u.cache_hit_ratio !== undefined) {
        lines.push(`- cache_hit_ratio: ${u.cache_hit_ratio.toFixed(3)}`);
      }
    }
  }
  return lines.join('\n');
}

export function renderMarkdownReport(
  report: ReadinessReport,
  options: MarkdownReportOptions = {},
): string {
  const threshold = options.aiConcernThreshold ?? 'medium';
  const sections: string[] = [
    `# Veyra launch-readiness report`,
    '',
    renderExecutiveSummary(report),
    '',
    renderDeclaredContextSection(options.declaredContext),
    '',
    renderObservedEvidenceSection(options.observedEvidence),
    '',
    renderLaunchBlockers(report),
    '',
    renderFindingsSection(report),
  ];
  // Tier 2 is OMITTED entirely when AI is disabled (per step 13b
  // contract). The Sources section below carries the disabled note.
  if (options.aiConcerns !== undefined) {
    sections.push('');
    sections.push(renderAiConcernsSection(options.aiConcerns, threshold));
  }
  sections.push('');
  sections.push(renderActiveOutcomesSection());
  sections.push('');
  sections.push(renderControlCards(report));
  sections.push('');
  sections.push(renderSuggestedTestsSection(report));
  sections.push('');
  sections.push(renderUncertaintyNotesSection(report));
  sections.push('');
  sections.push(renderSourcesSection(options));
  return sections.join('\n').trimEnd() + '\n';
}
