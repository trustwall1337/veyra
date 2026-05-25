import { promises as fs } from 'node:fs';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type {
  DeclaredIntent,
  ObservedEvidence,
} from '../../types/declared-context.js';
import type { Finding } from '../../types/finding.js';

import {
  CHECKLIST,
  evaluateChecklist,
  type ChecklistContext,
  type ChecklistItem,
} from './checklist.js';
import type {
  BusinessLogicInput,
  BusinessLogicOutput,
} from './types.js';

const METADATA: AgentMetadata = {
  id: 'business-logic',
  version: '0.1.0',
  declared_dependencies: ['declared-context.json'],
};

const UNCERTAINTY_NOTE =
  'deterministic checklist over declared context; lack of declared signal does not imply absence — these are negative-test suggestions';

interface DeclaredContextShape {
  readonly observed_evidence?: Partial<ObservedEvidence>;
  readonly declared_intent?: DeclaredIntent;
}

async function readDeclaredContext(
  artifactPath: string | undefined,
): Promise<DeclaredContextShape | undefined> {
  if (artifactPath === undefined) return undefined;
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    return JSON.parse(text) as DeclaredContextShape;
  } catch {
    return undefined;
  }
}

function buildFinding(item: ChecklistItem): Finding {
  return {
    id: `${item.id}-coverage-gap`,
    control_id: item.control_id,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'add_test',
    blast_radius: 'tenant_data',
    title: `Business-logic check: ${item.title}`,
    summary: `${item.rationale} Negative tests should be added. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
    suggested_test_ids: item.suggested_tests,
  };
}

export const businessLogicAgent: VeyraAgent<
  BusinessLogicInput,
  BusinessLogicOutput
> = {
  metadata: METADATA,
  async run(
    input: BusinessLogicInput,
    _context: AgentExecutionContext,
  ): Promise<AgentResult<BusinessLogicOutput>> {
    const declared =
      input.declaredContext ??
      (await readDeclaredContext(input.declaredContextPath));
    const ctx: ChecklistContext = declared ?? {};
    const evaluation = evaluateChecklist(ctx);
    const findings = evaluation.applicable.map(buildFinding);

    return {
      status: 'completed',
      artifacts: [],
      findings,
      warnings: [],
      output: {
        findingsCount: findings.length,
        checklistEvaluated: evaluation.evaluated,
      },
    };
  },
};

// Exported for the snapshot / never-confirmed assertion test.
export { CHECKLIST };
