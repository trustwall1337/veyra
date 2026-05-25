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
  // Trust the schema-validated structure but project explicitly into
  // the typed shape.
  return ok(parsed as DeclaredIntent);
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
