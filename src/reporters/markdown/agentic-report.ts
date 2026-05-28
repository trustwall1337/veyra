import type { Finding } from '../../types/finding.js';
import type { LedgerGap } from '../../core/orchestrator/required-evidence-ledger.js';
import type { BudgetSnapshot } from '../../core/orchestrator/loop-budget.js';

/**
 * Markdown report renderer for the agentic loop (Phase 3 / Step 37). The
 * report stops being a per-control grid: the authored narrative + a root-cause
 * synthesis sit at the top; deterministic per-control cards remain below as
 * the audit appendix; a loop-trace summary lets the operator see what the AI
 * did (tools called, denials, result-rejects, budget consumed). The narrative
 * is the citation-linted output from Step 36.
 *
 * Output-language discipline: this renderer emits ONLY the allowed vocabulary
 * (`checked / found / missing / appears launch-blocking / needs human review
 * / negative tests should be added`). It never writes `secure / safe /
 * compliant`. A snapshot test asserts this.
 */

export interface LoopTraceSummary {
  readonly tools_called: number;
  readonly denials: number;
  readonly arg_rejects: number;
  readonly tool_errors: number;
  readonly result_rejects: number;
  readonly subagent_errors: number;
  readonly budget_consumed: BudgetSnapshot;
}

export interface AgenticReportInput {
  readonly narrative_prose: string;
  readonly findings: readonly Finding[];
  readonly ledger_missing: readonly LedgerGap[];
  readonly trace: LoopTraceSummary;
  /**
   * Whether the narrative came from the deterministic fallback (Step 36
   * hard-fail). A `--no-ai` scan also surfaces here.
   */
  readonly narrative_used_fallback: boolean;
}

const SECTION_NARRATIVE = '## Narrative';
const SECTION_ROOT_CAUSE = '## Root-cause synthesis';
const SECTION_CARDS = '## Per-control cards (audit appendix)';
const SECTION_ACTIVE_OUTCOMES = '## Active-validation outcomes';
const SECTION_COVERAGE_GAPS = '## Coverage gaps';
const SECTION_TRACE = '## Loop-trace summary';

/** Build the markdown report. */
export function renderAgenticReport(input: AgenticReportInput): string {
  const parts: string[] = [];

  // 1. Narrative (top, atop the cards — PLAN §M ordering).
  parts.push(SECTION_NARRATIVE);
  if (input.narrative_used_fallback) {
    parts.push(
      '_The deterministic fallback narrative is rendered here because the authored narrative could not be lint-cleared. The per-control cards below remain the audit appendix._',
    );
  }
  parts.push(input.narrative_prose.trim() || '_No narrative produced._');
  parts.push('');

  // 2. Root-cause synthesis (very light; full predicate output is a follow-up).
  parts.push(SECTION_ROOT_CAUSE);
  parts.push(renderRootCause(input.findings));
  parts.push('');

  // 3. Per-control cards (audit appendix — retained, not removed).
  parts.push(SECTION_CARDS);
  parts.push(renderCards(input.findings));
  parts.push('');

  // 4. Active-validation outcomes (currently surfaced via the trace).
  parts.push(SECTION_ACTIVE_OUTCOMES);
  parts.push(renderActiveOutcomes(input.trace));
  parts.push('');

  // 5. Coverage gaps.
  parts.push(SECTION_COVERAGE_GAPS);
  parts.push(renderCoverageGaps(input.findings, input.ledger_missing));
  parts.push('');

  // 6. Loop-trace summary.
  parts.push(SECTION_TRACE);
  parts.push(renderTraceSummary(input.trace));

  return parts.join('\n');
}

function renderRootCause(findings: readonly Finding[]): string {
  const blockers = findings.filter((f) => f.review_action === 'fix_before_launch');
  const review = findings.filter((f) => f.review_action === 'review_before_launch');
  if (blockers.length === 0 && review.length === 0) {
    return 'Findings were checked; none appear launch-blocking.';
  }
  const lines: string[] = [];
  if (blockers.length > 0) {
    lines.push(
      `- ${String(blockers.length)} finding(s) appear launch-blocking and need human review.`,
    );
  }
  if (review.length > 0) {
    lines.push(
      `- ${String(review.length)} finding(s) need human review before launch.`,
    );
  }
  return lines.join('\n');
}

function renderCards(findings: readonly Finding[]): string {
  if (findings.length === 0) return '_No findings._';
  const lines: string[] = [];
  for (const f of findings) {
    lines.push(`### ${f.title}`);
    lines.push(`- control: \`${f.control_id}\``);
    lines.push(`- type: \`${f.finding_type}\``);
    lines.push(`- review: \`${f.review_action}\``);
    lines.push(`- evidence strength: \`${f.evidence_strength}\``);
    lines.push('');
    lines.push(f.summary);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderActiveOutcomes(trace: LoopTraceSummary): string {
  // For Mode A read-only the section is short; full active outcomes come in 39.
  return [
    `- tools called: ${String(trace.tools_called)}`,
    `- denials: ${String(trace.denials)}`,
    `- arg-rejects: ${String(trace.arg_rejects)}`,
    `- tool-errors: ${String(trace.tool_errors)}`,
    `- result-rejects: ${String(trace.result_rejects)}`,
    `- sub-agent errors: ${String(trace.subagent_errors)}`,
  ].join('\n');
}

function renderCoverageGaps(
  findings: readonly Finding[],
  ledger_missing: readonly LedgerGap[],
): string {
  const gapFindings = findings.filter((f) => f.finding_type === 'coverage_gap');
  if (gapFindings.length === 0 && ledger_missing.length === 0) {
    return '_No coverage gaps found._';
  }
  const lines: string[] = [];
  for (const g of ledger_missing) {
    lines.push(
      `- ${g.baseline_item_id} (control \`${g.gap_control_id}\`): required evidence was missing; needs human review.`,
    );
  }
  for (const f of gapFindings) {
    if (!ledger_missing.some((g) => g.gap_control_id === f.control_id)) {
      lines.push(`- ${f.title}: ${f.summary}`);
    }
  }
  return lines.join('\n');
}

function renderTraceSummary(trace: LoopTraceSummary): string {
  const b = trace.budget_consumed;
  return [
    `- tool calls: ${String(b.tool_calls)} / cap`,
    `- loop steps: ${String(b.steps)} / cap ${String(b.caps.max_steps)}`,
    `- AI cost units: ${String(b.cost_units)} / cap ${String(b.caps.max_ai_cost_units)}`,
    `- wall-clock: ${String(b.elapsed_ms)} ms / cap ${String(b.caps.max_wall_clock_ms)} ms`,
  ].join('\n');
}
