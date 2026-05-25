import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { redactSecrets } from '../../ai/sanitization.js';
import type {
  AiProvider,
  AiRequest,
  AiResponse,
} from '../../ai/types.js';
import type { InventoryBootstrap } from '../product-understanding/inventory/types.js';
import type { Result } from '../../types/result.js';
import { err, ok } from '../../types/result.js';
import type { SanitizedMessage } from '../../types/sanitized-message.js';

import type {
  AiDeclaredIntentArtifact,
  DeclaredIntent,
} from './types.js';

export const AI_INTENT_ARTIFACT_NAME = 'ai-declared-intent.json';

export class AiProductUnderstandingError extends Error {
  override readonly name = 'AiProductUnderstandingError';
}

export interface BuildAiIntentOptions {
  readonly inventoryArtifactPath: string;
  readonly provider: AiProvider;
  readonly model: string;
  readonly maxOutputTokens?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

const INTENT_RESPONSE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    purpose: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        confidence: { enum: ['low', 'medium', 'high'] },
        uncertainty_notes: { type: 'string' },
      },
      required: ['value', 'confidence'],
    },
    user_roles: {
      type: 'object',
      properties: {
        value: { type: 'array', items: { type: 'string' } },
        confidence: { enum: ['low', 'medium', 'high'] },
        uncertainty_notes: { type: 'string' },
      },
      required: ['value', 'confidence'],
    },
    data_kinds: {
      type: 'object',
      properties: {
        value: { type: 'array', items: { type: 'string' } },
        confidence: { enum: ['low', 'medium', 'high'] },
        uncertainty_notes: { type: 'string' },
      },
      required: ['value', 'confidence'],
    },
    auth_model: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        confidence: { enum: ['low', 'medium', 'high'] },
        uncertainty_notes: { type: 'string' },
      },
      required: ['value', 'confidence'],
    },
  },
};

const SYSTEM_PROMPT =
  'You are a product-understanding inference assistant. Given the deterministic inventory of a SaaS project, infer the declared intent: what the product is, what user roles it has, what kinds of data it handles, and what auth model is in use. Output JSON that strictly matches the response schema. Use the confidence levels low/medium/high. Include uncertainty_notes when the inference is shaky.';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readInventory(
  inventoryArtifactPath: string,
): Promise<Result<InventoryBootstrap, AiProductUnderstandingError>> {
  try {
    const text = await fs.readFile(inventoryArtifactPath, 'utf8');
    return ok(JSON.parse(text) as InventoryBootstrap);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(
      new AiProductUnderstandingError(
        `failed to read inventory artifact at ${inventoryArtifactPath}: ${m}`,
      ),
    );
  }
}

function buildPrompt(inventory: InventoryBootstrap): SanitizedMessage {
  // Convert inventory to a sanitized prompt body. We pass it through
  // 02c redactSecrets which mints the SanitizedMessage brand — that's
  // the only chokepoint allowed to do so.
  const ev = inventory.observed_evidence;
  const lines: string[] = [];
  lines.push('Project inventory:');
  if (ev.package_json_digest !== undefined) {
    lines.push(`- name: ${ev.package_json_digest.name}`);
    if (ev.package_json_digest.dependencies !== undefined) {
      const depNames = Object.keys(ev.package_json_digest.dependencies).join(', ');
      lines.push(`- dependencies: ${depNames}`);
    }
  }
  lines.push(`- framework: ${ev.framework}`);
  if (ev.routes.length > 0) {
    lines.push(`- routes: ${ev.routes.join(', ')}`);
  }
  if (ev.env_declarations.length > 0) {
    lines.push(`- env vars referenced: ${ev.env_declarations.join(', ')}`);
  }
  if (ev.supabase_schema !== undefined) {
    lines.push(
      `- supabase tables: ${ev.supabase_schema.tables.join(', ')}`,
    );
  }
  return redactSecrets(lines.join('\n'));
}

function isConfidenceTaggedString(v: unknown): v is { value: string; confidence: 'low' | 'medium' | 'high'; uncertainty_notes?: string } {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r['value'] !== 'string') return false;
  if (r['confidence'] !== 'low' && r['confidence'] !== 'medium' && r['confidence'] !== 'high') return false;
  if (r['uncertainty_notes'] !== undefined && typeof r['uncertainty_notes'] !== 'string') return false;
  return true;
}

function isConfidenceTaggedStringList(v: unknown): v is { value: string[]; confidence: 'low' | 'medium' | 'high'; uncertainty_notes?: string } {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r['value']) || !r['value'].every((x) => typeof x === 'string')) return false;
  if (r['confidence'] !== 'low' && r['confidence'] !== 'medium' && r['confidence'] !== 'high') return false;
  if (r['uncertainty_notes'] !== undefined && typeof r['uncertainty_notes'] !== 'string') return false;
  return true;
}

function parseDeclaredIntent(
  response: AiResponse,
): Result<DeclaredIntent, AiProductUnderstandingError> {
  const parsed = response.parsed_output;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return err(
      new AiProductUnderstandingError(
        'AI response did not include parsed_output as an object',
      ),
    );
  }
  // Local schema validation per retro-17c: do not trust the
  // provider's response_schema enforcement; re-validate every field
  // before persisting. Reject unknown fields that look like
  // injection attempts.
  const allowed = new Set([
    'purpose',
    'user_roles',
    'data_kinds',
    'auth_model',
  ]);
  const intent: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowed.has(k)) {
      // Unknown field — reject the whole response. Better to fall
      // back to deterministic fallback than to persist provider noise.
      return err(
        new AiProductUnderstandingError(
          `AI response contained an unexpected field "${k}"`,
        ),
      );
    }
    if (k === 'purpose' || k === 'auth_model') {
      if (!isConfidenceTaggedString(v)) {
        return err(
          new AiProductUnderstandingError(
            `AI response field "${k}" did not match the expected shape (string value + confidence + optional uncertainty_notes)`,
          ),
        );
      }
      intent[k] = v;
    } else if (k === 'user_roles' || k === 'data_kinds') {
      if (!isConfidenceTaggedStringList(v)) {
        return err(
          new AiProductUnderstandingError(
            `AI response field "${k}" did not match the expected shape (string[] value + confidence + optional uncertainty_notes)`,
          ),
        );
      }
      intent[k] = v;
    }
  }
  return ok(intent as DeclaredIntent);
}

export async function buildAiDeclaredIntent(
  options: BuildAiIntentOptions,
): Promise<Result<AiDeclaredIntentArtifact, AiProductUnderstandingError>> {
  const inventoryR = await readInventory(options.inventoryArtifactPath);
  if (!inventoryR.ok) return inventoryR;

  const sanitizedBody = buildPrompt(inventoryR.value);
  const request: AiRequest = {
    model_id: options.model,
    system: redactSecrets(SYSTEM_PROMPT),
    messages: [
      {
        role: 'user',
        content: sanitizedBody,
      },
    ],
    max_output_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    response_schema: INTENT_RESPONSE_SCHEMA,
  };
  const fp = sha256(JSON.stringify(request));

  const aiResult = await options.provider.complete(request);
  if (!aiResult.ok) {
    return err(
      new AiProductUnderstandingError(
        `AI provider call failed: ${aiResult.error.message}`,
      ),
    );
  }
  const intentR = parseDeclaredIntent(aiResult.value);
  if (!intentR.ok) return intentR;

  return ok({
    declared_intent: intentR.value,
    model_id: aiResult.value.model_id,
    prompt_fingerprint_sha256: fp,
    observed_at: new Date().toISOString(),
  });
}

export async function writeAiDeclaredIntentArtifact(
  artifactDir: string,
  artifact: AiDeclaredIntentArtifact,
): Promise<Result<string, AiProductUnderstandingError>> {
  const out = path.join(artifactDir, AI_INTENT_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(out, JSON.stringify(artifact, null, 2), 'utf8');
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(
      new AiProductUnderstandingError(`failed to write ${out}: ${m}`),
    );
  }
}

// ── Optional VeyraAgent wrapper ────────────────────────────────────
// Registered only when an AiProvider is wired (the orchestrator skips
// AI agents in --no-ai mode by not constructing them). The wrapper
// makes the AI step independently registerable so the orchestrator
// can list its trace separately and skip it cleanly.

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';

export interface AiProductUnderstandingInput {
  readonly inventoryArtifactPath: string;
  readonly provider: AiProvider;
  readonly model: string;
}

export interface AiProductUnderstandingOutput {
  readonly artifactPath: string;
}

const AGENT_METADATA: AgentMetadata = {
  id: 'ai-product-understanding',
  version: '0.1.0',
  declared_dependencies: ['inventory-bootstrap.json'],
};

export function createAiProductUnderstandingAgent(): VeyraAgent<
  AiProductUnderstandingInput,
  AiProductUnderstandingOutput
> {
  return {
    metadata: AGENT_METADATA,
    async run(
      input: AiProductUnderstandingInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<AiProductUnderstandingOutput>> {
      const r = await buildAiDeclaredIntent({
        inventoryArtifactPath: input.inventoryArtifactPath,
        provider: input.provider,
        model: input.model,
      });
      if (!r.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_product_understanding_failed: ${r.error.message}`],
        };
      }
      const w = await writeAiDeclaredIntentArtifact(context.artifactDir, r.value);
      if (!w.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_product_understanding_write_failed: ${w.error.message}`],
        };
      }
      const artifact: ArtifactRef = {
        scanId: context.scanId,
        kind: 'evidence_inventory',
        path: w.value,
      };
      return {
        status: 'completed',
        artifacts: [artifact],
        findings: [],
        warnings: [],
        output: { artifactPath: w.value },
      };
    },
  };
}
