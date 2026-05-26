/**
 * AI Security Planner agent (step 2.07b).
 *
 * Phase 2 AI agent that proposes scan plans from the CLOSED
 * negative-test catalog. Prioritises and parameterises entries based
 * on declared context. Constraints (REVISION_AI_SHAPE §8):
 *
 *  4. AI never invents new active tests. The catalog at
 *     `src/agents/sandbox-runner/test-catalog/` is checked-in code
 *     and the planner's output is schema-validated against the
 *     catalog's controlId set.
 *
 *  6. AI never deletes from the mandatory baseline. The compiler at
 *     step 2.07c re-injects any omitted baseline controls — but the
 *     planner is also expected to include them.
 *
 * Per PHASE_2_PLAN §10.2: no tool-use loops. Structured-output chat
 * completion only.
 *
 * Step 2.02 codex pf2 alignment: the producer identity flows through
 * an opaque `AnalyzerId` (not a closed `'ai_security_planner'`
 * literal in shared types).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { asAnalyzerId, type AnalyzerId } from '../../types/identity.js';
import type {
  ProposedScanPlan,
  ProposedScanPlanEntry,
} from '../../types/scan-plan.js';
import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import type { AiProvider, AiRequest } from '../../ai/types.js';
import { type Result, err, ok } from '../../types/result.js';
import type { SanitizedMessage } from '../../types/sanitized-message.js';
import { redactSecrets } from '../../ai/sanitization.js';
// redactSecrets returns SanitizedMessage and is the only Phase 1
// sanitizer that's both safe and ergonomic for prompt construction.
import { getCatalogControlIds } from '../sandbox-runner/test-catalog/index.js';

export const AI_SECURITY_PLANNER_AGENT_ID = 'ai-security-planner';
export const PROPOSED_PLAN_ARTIFACT = 'proposed-scan-plan.json';

/**
 * Mandatory baseline — every Phase 2 scan must check these controls.
 * If the AI planner omits any of them, the compiler (step 2.07c)
 * re-injects from the deterministic fallback.
 */
export const MANDATORY_BASELINE_CONTROL_IDS: readonly string[] = [
  'cc-11-1',
  'cc-11-2',
  'cc-11-5',
  'cc-11-9',
];

const PLANNER_ANALYZER_ID: AnalyzerId = (() => {
  const r = asAnalyzerId('ai-security-planner');
  if (!r.ok) throw r.error;
  return r.value;
})();

const METADATA: AgentMetadata = {
  id: AI_SECURITY_PLANNER_AGENT_ID,
  version: '0.1.0',
  declared_dependencies: ['findings.json', 'declared-context.json'],
  produces: [PROPOSED_PLAN_ARTIFACT],
};

export interface AiSecurityPlannerInput {
  readonly aiProvider?: AiProvider;
  readonly aiDisabled: boolean;
  readonly findingsPath: string;
  readonly declaredContextPath: string;
}

export interface AiSecurityPlannerOutput {
  readonly proposed: ProposedScanPlan;
  /** True when AI was opted out (`--no-ai` or missing provider). */
  readonly deterministic_fallback: boolean;
}

/**
 * Deterministic fallback: every mandatory baseline control gets a
 * `priority: 'medium'` entry. Used when `aiDisabled` is true OR when
 * the AI call fails. The compiler treats this as a valid producer
 * output (the producer_id distinguishes from AI output).
 */
function buildDeterministicPlan(
  scanId: string,
  catalogIds: readonly string[],
): ProposedScanPlan {
  const baselineSet = new Set(MANDATORY_BASELINE_CONTROL_IDS);
  const entries: ProposedScanPlanEntry[] = catalogIds
    .filter((id) => baselineSet.has(id))
    .map((id, idx) => ({
      test_id: `${id}-baseline-${String(idx)}`,
      control_id: id,
      priority: 'medium',
      parameters: {},
      justification: `deterministic baseline — ${id} runs on every Phase 2 scan`,
    }));
  return {
    scan_id: scanId,
    producer_id: PLANNER_ANALYZER_ID,
    entries,
    generated_at: new Date().toISOString(),
  };
}

export function createAiSecurityPlannerAgent(): VeyraAgent<
  AiSecurityPlannerInput,
  AiSecurityPlannerOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: AiSecurityPlannerInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<AiSecurityPlannerOutput>> {
      const catalogIds = getCatalogControlIds();

      // `--no-ai` or missing provider → deterministic fallback.
      if (input.aiDisabled || input.aiProvider === undefined) {
        const proposed = buildDeterministicPlan(context.scanId, catalogIds);
        return persistAndReturn(context, proposed, true, []);
      }

      // Read findings + declared context. Sanitize before prompt.
      let findingsText = '';
      let declaredContextText = '';
      try {
        findingsText = await fs.readFile(input.findingsPath, 'utf8');
      } catch {
        // Findings missing → AI planner cannot reason; fall back.
        const proposed = buildDeterministicPlan(context.scanId, catalogIds);
        return persistAndReturn(context, proposed, true, ['findings.json missing']);
      }
      try {
        declaredContextText = await fs.readFile(
          input.declaredContextPath,
          'utf8',
        );
      } catch {
        // declared-context optional; continue with empty.
      }

      const promptText = [
        '## Catalog',
        ...catalogIds.map((id) => `- ${id}`),
        '',
        '## Mandatory baseline (every Phase 2 scan must include)',
        ...MANDATORY_BASELINE_CONTROL_IDS.map((id) => `- ${id}`),
        '',
        '## Declared context (sanitized)',
        declaredContextText.slice(0, 4000),
        '',
        '## Findings (sanitized)',
        findingsText.slice(0, 4000),
      ].join('\n');

      const sanitized: SanitizedMessage = redactSecrets(promptText);

      const aiRequest: AiRequest = {
        model_id: '',
        system: redactSecrets(
          'You are the Veyra Phase 2 active-validation planner. Output a JSON plan whose entries draw ONLY from the provided catalog. Include every mandatory baseline control. Do not invent new test types.',
        ),
        messages: [{ role: 'user', content: sanitized }],
        max_output_tokens: 1500,
        response_schema: {
          type: 'object',
          required: ['entries'],
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                required: ['test_id', 'control_id', 'priority', 'justification'],
                properties: {
                  test_id: { type: 'string' },
                  control_id: { type: 'string' },
                  priority: { type: 'string' },
                  justification: { type: 'string' },
                  parameters: { type: 'object' },
                },
              },
            },
          },
        },
      };

      const aiR = await input.aiProvider.complete(aiRequest);
      if (!aiR.ok) {
        const proposed = buildDeterministicPlan(context.scanId, catalogIds);
        return persistAndReturn(context, proposed, true, [
          `AI planner call failed (${aiR.error.kind}): falling back to deterministic baseline`,
        ]);
      }

      const parsed = aiR.value.parsed_output;
      const entries = validateAndFilter(parsed, catalogIds);
      const proposed: ProposedScanPlan = {
        scan_id: context.scanId,
        producer_id: PLANNER_ANALYZER_ID,
        entries,
        generated_at: new Date().toISOString(),
      };
      return persistAndReturn(context, proposed, false, []);
    },
  };
}

function validateAndFilter(
  raw: unknown,
  catalogIds: readonly string[],
): readonly ProposedScanPlanEntry[] {
  const catalogSet = new Set(catalogIds);
  if (typeof raw !== 'object' || raw === null) return [];
  const arr = (raw as Record<string, unknown>)['entries'];
  if (!Array.isArray(arr)) return [];
  const out: ProposedScanPlanEntry[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const it = item as Record<string, unknown>;
    const control_id = typeof it['control_id'] === 'string' ? it['control_id'] : '';
    const test_id = typeof it['test_id'] === 'string' ? it['test_id'] : '';
    const priorityStr = typeof it['priority'] === 'string' ? it['priority'] : 'medium';
    const justification = typeof it['justification'] === 'string' ? it['justification'] : '';
    // Constraint 4: silently drop entries whose control_id is NOT in
    // the catalog. (The schema also rejected them upstream when the
    // adapter's schema validator was strict enough — defense in depth.)
    if (!catalogSet.has(control_id)) continue;
    const priority: 'low' | 'medium' | 'high' =
      priorityStr === 'low' || priorityStr === 'high' ? priorityStr : 'medium';
    const parameters =
      typeof it['parameters'] === 'object' && it['parameters'] !== null
        ? (it['parameters'] as Record<string, unknown>)
        : {};
    out.push({
      test_id: test_id.length > 0 ? test_id : `${control_id}-ai-${String(out.length)}`,
      control_id,
      priority,
      parameters,
      justification,
    });
  }
  return out;
}

async function persistAndReturn(
  context: AgentExecutionContext,
  proposed: ProposedScanPlan,
  deterministicFallback: boolean,
  warnings: readonly string[],
): Promise<AgentResult<AiSecurityPlannerOutput>> {
  await fs.mkdir(context.artifactDir, { recursive: true });
  const outPath = path.join(context.artifactDir, PROPOSED_PLAN_ARTIFACT);
  await fs.writeFile(outPath, JSON.stringify(proposed, null, 2), 'utf8');
  const artifacts: ArtifactRef[] = [
    { scanId: context.scanId, kind: 'evidence_inventory', path: outPath },
  ];
  return {
    status: 'completed',
    artifacts,
    findings: [],
    warnings: [...warnings],
    output: { proposed, deterministic_fallback: deterministicFallback },
  };
}
