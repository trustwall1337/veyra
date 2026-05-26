/**
 * AI Explainer agent (step 2.09).
 *
 * Per-EvidenceKind enrichment. Takes every finding produced by
 * upstream agents and writes a plain-language explanation, refined
 * suggested tests, and a control-card narrative. AI input is
 * sanitized. AI NEVER classifies; AI NEVER decides what to fix.
 *
 * Per §10.2: "AI never classifies. AI never decides what to fix."
 * Per §10.5: every output carries `confidence` + `uncertainty_notes`.
 * Per §4.10: disabled when --no-ai (the orchestrator must not require
 * this agent to complete).
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
import type { Finding } from '../../types/finding.js';
import type { AiProvider, AiRequest } from '../../ai/types.js';
import { redactSecrets } from '../../ai/sanitization.js';

export const AI_EXPLAINER_AGENT_ID = 'ai-explainer';
export const AI_ENRICHMENTS_ARTIFACT = 'ai-enrichments.json';

const METADATA: AgentMetadata = {
  id: AI_EXPLAINER_AGENT_ID,
  version: '0.1.0',
  declared_dependencies: ['findings.json'],
  produces: [AI_ENRICHMENTS_ARTIFACT],
};

export interface AiEnrichment {
  readonly finding_id: string;
  readonly control_id: string;
  readonly explanation: string;
  readonly suggested_tests_refined: readonly string[];
  readonly control_card_narrative: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes: string;
  readonly model_id: string;
  /** Mandatory audit field per §10.6. */
  readonly prompt_fingerprint_sha256?: string;
}

export interface AiExplainerInput {
  readonly findings: readonly Finding[];
  readonly aiProvider?: AiProvider;
  readonly aiDisabled: boolean;
}

export interface AiExplainerOutput {
  readonly enrichments: readonly AiEnrichment[];
  readonly skipped: boolean;
}

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: [
    'explanation',
    'suggested_tests_refined',
    'control_card_narrative',
    'confidence',
    'uncertainty_notes',
  ],
  properties: {
    explanation: { type: 'string' },
    suggested_tests_refined: { type: 'array', items: { type: 'string' } },
    control_card_narrative: { type: 'string' },
    confidence: { type: 'string' },
    uncertainty_notes: { type: 'string' },
  },
};

export function createAiExplainerAgent(): VeyraAgent<
  AiExplainerInput,
  AiExplainerOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: AiExplainerInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<AiExplainerOutput>> {
      // §4.10: --no-ai → no artifact, no agent output. Orchestrator
      // must complete regardless.
      if (input.aiDisabled || input.aiProvider === undefined) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: input.aiDisabled
            ? ['ai-explainer skipped (--no-ai)']
            : ['ai-explainer skipped (no AiProvider configured)'],
          output: { enrichments: [], skipped: true },
        };
      }

      const enrichments: AiEnrichment[] = [];
      const warnings: string[] = [];

      for (const finding of input.findings) {
        const promptText = [
          `## Finding`,
          `- id: ${finding.id}`,
          `- control_id: ${finding.control_id}`,
          `- title: ${finding.title}`,
          `- summary: ${finding.summary}`,
        ].join('\n');
        const sanitized = redactSecrets(promptText);
        const aiRequest: AiRequest = {
          model_id: '',
          system: redactSecrets(
            'You are Veyra Phase 2 active-validation explainer. Output JSON: { explanation, suggested_tests_refined, control_card_narrative, confidence, uncertainty_notes }. You NEVER classify the finding. You NEVER decide what to fix.',
          ),
          messages: [{ role: 'user', content: sanitized }],
          max_output_tokens: 800,
          response_schema: SCHEMA,
        };
        const r = await input.aiProvider.complete(aiRequest);
        if (!r.ok) {
          warnings.push(
            `ai-explainer call failed for ${finding.id} (${r.error.kind}); skipping`,
          );
          continue;
        }
        const parsed = r.value.parsed_output;
        if (typeof parsed !== 'object' || parsed === null) continue;
        const p = parsed as Record<string, unknown>;
        const confidence = typeof p['confidence'] === 'string' ? p['confidence'] : 'low';
        const normalizedConfidence: 'low' | 'medium' | 'high' =
          confidence === 'high' || confidence === 'medium' ? confidence : 'low';
        enrichments.push({
          finding_id: finding.id,
          control_id: finding.control_id,
          explanation: typeof p['explanation'] === 'string' ? p['explanation'] : '',
          suggested_tests_refined: Array.isArray(p['suggested_tests_refined'])
            ? (p['suggested_tests_refined'] as unknown[]).filter(
                (x): x is string => typeof x === 'string',
              )
            : [],
          control_card_narrative:
            typeof p['control_card_narrative'] === 'string'
              ? p['control_card_narrative']
              : '',
          confidence: normalizedConfidence,
          uncertainty_notes:
            typeof p['uncertainty_notes'] === 'string' ? p['uncertainty_notes'] : '',
          model_id: r.value.model_id,
        });
      }

      const artifacts: ArtifactRef[] = [];
      if (enrichments.length > 0) {
        await fs.mkdir(context.artifactDir, { recursive: true });
        const outPath = path.join(context.artifactDir, AI_ENRICHMENTS_ARTIFACT);
        await fs.writeFile(
          outPath,
          JSON.stringify(
            { scan_id: context.scanId, enrichments },
            null,
            2,
          ),
          'utf8',
        );
        artifacts.push({
          scanId: context.scanId,
          kind: 'evidence_inventory',
          path: outPath,
        });
      }

      return {
        status: 'completed',
        artifacts,
        findings: [],
        warnings,
        output: { enrichments, skipped: false },
      };
    },
  };
}
