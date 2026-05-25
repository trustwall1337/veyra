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
import type { ArtifactRef } from '../../types/artifact.js';
import type {
  ControlCard,
  ReadinessStatus,
} from '../../types/control-card.js';
import type { EvidenceItem } from '../../types/evidence.js';
import type { Finding } from '../../types/finding.js';
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

function buildControlCard(
  control: ControlDefinition,
  findings: readonly Finding[],
  evidence: readonly EvidenceItem[],
): ControlCard {
  const status: ReadinessStatus = computeReadiness({ findings, evidence });
  return {
    control_id: control.control_id,
    title: control.expected_behavior,
    readiness_status: status,
    findings,
    evidence,
    suggested_tests: [],
    uncertainty_notes: [],
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
  const cards = CONTROLS.map((control) =>
    buildControlCard(
      control,
      findingsForControl(control, input.findings),
      input.evidenceByControl?.[control.control_id] ?? [],
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
