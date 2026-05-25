/**
 * Evidence-report agent (step 14).
 *
 * Composes upstream agent findings into ControlCard[] and a
 * ReadinessReport. Drives `--fail-on-blocker` by reporting the count
 * of `launch_blocker`-status cards.
 *
 * Per step 14 Guardrails: this agent does NOT generate new heuristic
 * findings of its own. It joins upstream output to control definitions
 * and computes readiness deterministically.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { AIConcern } from '../../types/ai-concern.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type {
  ControlCard,
  ReadinessStatus,
} from '../../types/control-card.js';
import type { EvidenceItem } from '../../types/evidence.js';
import type { Finding } from '../../types/finding.js';
import type { Hypothesis, HypothesisRef } from '../../types/hypothesis.js';
import type {
  ReadinessReport,
  ReadinessSummary,
} from '../../types/readiness-report.js';
import { err, ok, type Result } from '../../types/result.js';

import { CONTROLS, type ControlDefinition } from './controls.js';
import { computeReadiness } from './readiness.js';

const METADATA: AgentMetadata = {
  id: 'evidence-report',
  version: '0.1.0',
  declared_dependencies: ['*'],
};

export interface EvidenceReportInput {
  readonly projectName?: string;
  readonly veyraVersion?: string;
  /** All upstream findings to compose into control cards. */
  readonly findings: readonly Finding[];
  /** Optional supporting evidence items keyed by control_id. */
  readonly evidenceByControl?: Readonly<
    Record<string, readonly EvidenceItem[]>
  >;
  /**
   * Hypotheses produced by AI Inference (08d). Attached to control
   * cards in Pass-2 (revision §4.2 rule 1): when a hypothesis's
   * `proposed_control_id` matches a control that has at least one
   * Finding, the hypothesis is recorded as a supporting hypothesis on
   * the card. Never affects classification or readiness.
   */
  readonly hypotheses?: readonly Hypothesis[];
  /**
   * AIConcerns produced by Pass-2 disposition (revision §11). The
   * three-tier reporter renders these under "AI-suggested areas for
   * human review" — never mixed with Findings. AIConcerns never
   * affect `readiness_status` (constraints 1, 9).
   */
  readonly aiConcerns?: readonly AIConcern[];
}

export interface EvidenceReportOutput {
  readonly report: ReadinessReport;
  readonly launchBlockerCount: number;
}

export class EvidenceReportError extends Error {
  override readonly name = 'EvidenceReportError';
}

function findingsForControl(
  control: ControlDefinition,
  findings: readonly Finding[],
): readonly Finding[] {
  return findings.filter((f) => f.control_id === control.control_id);
}

function hypothesesForControl(
  control: ControlDefinition,
  findings: readonly Finding[],
  hypotheses: readonly Hypothesis[],
): readonly HypothesisRef[] {
  if (findings.length === 0) return [];
  // Pass-2 rule 1 (revision §4.2): hypothesis attaches when its
  // proposed_control_id matches a Finding's control_id AND the
  // hypothesis's evidence_refs are a subset of the Finding's
  // evidence_refs. For Phase 1 we apply the looser proposed_control_id
  // match; 18b's orchestrator can tighten the subset check when the
  // assertions audit lands.
  const factSet = new Set<string>(findings.flatMap((f) => f.evidence_refs));
  const attached: HypothesisRef[] = [];
  for (const h of hypotheses) {
    if (h.proposed_control_id !== control.control_id) continue;
    const refs = h.evidence_refs.map((r) => r.fact_id);
    const allSubset = refs.every((r) => factSet.has(r));
    // Allow attachment when there are no fact refs to compare against
    // (hypothesis cites evidence not in this control's finding set);
    // 18b will narrow as the orchestrator fills the assertions audit.
    if (refs.length === 0 || allSubset) {
      attached.push({ hypothesis_id: h.hypothesis_id });
    }
  }
  return attached;
}

function aiConcernsForControl(
  control: ControlDefinition,
  aiConcerns: readonly AIConcern[],
  hypothesesById: ReadonlyMap<string, Hypothesis>,
): readonly AIConcern[] {
  return aiConcerns.filter((c) => {
    const hyp = hypothesesById.get(c.originating_hypothesis_id);
    return hyp?.proposed_control_id === control.control_id;
  });
}

function buildControlCard(
  control: ControlDefinition,
  findings: readonly Finding[],
  evidence: readonly EvidenceItem[],
  hypotheses: readonly Hypothesis[],
  aiConcerns: readonly AIConcern[],
  hypothesesById: ReadonlyMap<string, Hypothesis>,
): ControlCard {
  // Readiness rule remains deterministic: only Findings + Evidence
  // drive it. AIConcerns are advisory; supporting_hypothesis_refs are
  // attached after the status is computed.
  const status: ReadinessStatus = computeReadiness({ findings, evidence });
  const supporting = hypothesesForControl(control, findings, hypotheses);
  const concerns = aiConcernsForControl(control, aiConcerns, hypothesesById);
  return {
    control_id: control.control_id,
    title: control.expected_behavior,
    readiness_status: status,
    findings,
    evidence,
    suggested_tests: [],
    uncertainty_notes: [],
    ...(supporting.length > 0
      ? { supporting_hypothesis_refs: supporting }
      : {}),
    ...(concerns.length > 0
      ? { ai_concerns_for_this_control: concerns }
      : {}),
  };
}

function summarize(cards: readonly ControlCard[]): ReadinessSummary {
  let evidence_present = 0;
  let needs_review = 0;
  let launch_blocker = 0;
  for (const card of cards) {
    if (card.readiness_status === 'launch_blocker') launch_blocker += 1;
    else if (card.readiness_status === 'evidence_present') evidence_present += 1;
    else if (card.readiness_status === 'needs_review') needs_review += 1;
  }
  return {
    total_controls: cards.length,
    evidence_present,
    needs_review,
    launch_blocker,
  };
}

export function composeReport(
  input: EvidenceReportInput,
  context: { readonly scanId: string; readonly generatedAt: string },
): EvidenceReportOutput {
  const hypotheses = input.hypotheses ?? [];
  const aiConcerns = input.aiConcerns ?? [];
  const hypothesesById = new Map(hypotheses.map((h) => [h.hypothesis_id, h]));
  const cards = CONTROLS.map((control) =>
    buildControlCard(
      control,
      findingsForControl(control, input.findings),
      input.evidenceByControl?.[control.control_id] ?? [],
      hypotheses,
      aiConcerns,
      hypothesesById,
    ),
  );
  const summary = summarize(cards);
  const launchBlockers = cards
    .filter((c) => c.readiness_status === 'launch_blocker')
    .flatMap((c) => c.findings);
  const report: ReadinessReport = {
    scan_id: context.scanId,
    project_name: input.projectName ?? 'unnamed',
    generated_at: context.generatedAt,
    veyra_version: input.veyraVersion ?? '0.0.0',
    control_cards: cards,
    launch_blockers: launchBlockers,
    readiness_summary: summary,
  };
  return { report, launchBlockerCount: summary.launch_blocker };
}

async function writeJson(
  filePath: string,
  value: unknown,
): Promise<Result<string, EvidenceReportError>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
    return ok(filePath);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new EvidenceReportError(`failed to write ${filePath}: ${m}`));
  }
}

export const evidenceReportAgent: VeyraAgent<
  EvidenceReportInput,
  EvidenceReportOutput
> = {
  metadata: METADATA,
  async run(
    input: EvidenceReportInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<EvidenceReportOutput>> {
    const composed = composeReport(input, {
      scanId: context.scanId,
      generatedAt: new Date().toISOString(),
    });
    const artifacts: ArtifactRef[] = [];
    const warnings: string[] = [];

    const cardsR = await writeJson(
      path.join(context.artifactDir, 'control-cards.json'),
      { control_cards: composed.report.control_cards },
    );
    if (cardsR.ok) {
      artifacts.push({
        scanId: context.scanId,
        kind: 'control_cards',
        path: cardsR.value,
      });
    } else {
      warnings.push(cardsR.error.message);
    }

    const reportR = await writeJson(
      path.join(context.artifactDir, 'readiness-report.json'),
      composed.report,
    );
    if (reportR.ok) {
      artifacts.push({
        scanId: context.scanId,
        kind: 'veyra_report_json',
        path: reportR.value,
      });
    } else {
      warnings.push(reportR.error.message);
    }

    return {
      status: 'completed',
      artifacts,
      findings: [],
      warnings,
      output: composed,
    };
  },
};
