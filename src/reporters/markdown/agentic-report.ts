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

/**
 * Step 40c-v3 Decision D — one row per active-validation probe in the
 * rendered Markdown's "Active-validation outcomes" section. Distinct from
 * `findings` (which only emits for launch-blocker cases); every observed
 * probe contributes one row here, including `proven_denial` (the expected
 * non-finding case).
 */
export interface ActiveOutcomeRow {
  readonly probe_id: string;
  readonly control_id: string;
  readonly outcome: 'proven_denial' | 'proven_allowed' | 'inconclusive';
  readonly expectation: 'expect_denial' | 'expect_allow';
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
  /**
   * Step 40c-v3 Decision D — per-probe outcome rows (Mode B). When undefined
   * or empty, only the trace-counts variant of the section renders. When
   * non-empty, an explicit per-probe table renders ABOVE the trace counts
   * so an operator sees the actual outcomes (V6b).
   */
  readonly active_outcomes?: readonly ActiveOutcomeRow[];
  /**
   * Step 40d Decision G — one-line audit pointer to `project-briefing.json`
   * when the briefing was synthesized. Rendered under "Scan metadata" as
   * a footer reference; NEVER a rendered section. The flag distinguishes
   * the `degraded_fallback` case so an operator sees the briefing did not
   * land its AI-assisted form.
   */
  readonly project_briefing_ref?: {
    readonly basename: string;
    readonly degraded: boolean;
  };
}

const SECTION_NARRATIVE = '## Narrative';
const SECTION_ROOT_CAUSE = '## Root-cause synthesis';
const SECTION_CARDS = '## Per-control cards (audit appendix)';
const SECTION_ACTIVE_OUTCOMES = '## Active-validation outcomes';
const SECTION_COVERAGE_GAPS = '## Coverage gaps';
const SECTION_TRACE = '## Loop-trace summary';
const SECTION_SCAN_METADATA = '## Scan metadata';

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
  if (input.active_outcomes !== undefined && input.active_outcomes.length > 0) {
    parts.push(renderActiveOutcomeRows(input.active_outcomes));
    parts.push('');
  }
  parts.push(renderActiveOutcomes(input.trace));
  parts.push('');

  // 5. Coverage gaps.
  parts.push(SECTION_COVERAGE_GAPS);
  parts.push(renderCoverageGaps(input.findings, input.ledger_missing));
  parts.push('');

  // 6. Loop-trace summary.
  parts.push(SECTION_TRACE);
  parts.push(renderTraceSummary(input.trace));

  // 7. Scan metadata (Step 40d Decision G): one-line audit pointer to the
  // briefing artifact when synthesized. Never a section; never rendered
  // briefing field content.
  if (input.project_briefing_ref !== undefined) {
    parts.push('');
    parts.push(SECTION_SCAN_METADATA);
    parts.push(renderBriefingFooter(input.project_briefing_ref));
  }

  return parts.join('\n');
}

function renderBriefingFooter(ref: {
  readonly basename: string;
  readonly degraded: boolean;
}): string {
  const suffix = ref.degraded ? ' (degraded)' : '';
  return `- Project briefing: ${ref.basename}${suffix}`;
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

/**
 * Step 40c-v3 Decision D / codex §6.5 MF-3 — render one row per active probe
 * outcome (Mode B). Uses allowed-claim vocab ("checked", "observed",
 * "needs human review"); `proven_denial` rows are visible AS OUTCOMES but
 * never as Findings.
 */
function renderActiveOutcomeRows(
  rows: readonly ActiveOutcomeRow[],
): string {
  const lines: string[] = [];
  for (const row of rows) {
    const verdictPhrase =
      row.outcome === 'proven_allowed'
        ? row.expectation === 'expect_denial'
          ? 'appears launch-blocking and needs human review'
          : 'observed access matched expectation'
        : row.outcome === 'proven_denial'
          ? row.expectation === 'expect_denial'
            ? 'denial was checked and observed (no finding emitted)'
            : 'expected-allowed access was denied; needs human review'
          : 'outcome inconclusive; needs human review';
    lines.push(
      `- \`${row.probe_id}\` (control \`${row.control_id}\`, expectation \`${row.expectation}\`): observed \`${row.outcome}\` — ${verdictPhrase}.`,
    );
  }
  return lines.join('\n');
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
