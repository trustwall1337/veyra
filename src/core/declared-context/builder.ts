/**
 * Deterministic `declared-context-builder` (revision §1 layer 1c + §7.1).
 *
 * Sole writer of `declared-context.json`. Reads:
 *   - `inventory-bootstrap.json` (deterministic; owns `observed_evidence`)
 *   - `ai-declared-intent.json`  (AI; owns `declared_intent`, when present)
 *
 * Field-by-owner enforcement: the composer refuses to copy
 * `declared_intent` from the inventory artifact, or `observed_evidence`
 * from the AI artifact. Cross-field attempts produce an error, never a
 * silent merge. Adding a future inference source = new input + new owner
 * entry on the field map.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  DeclaredIntent,
  ObservedEvidence,
} from '../../types/declared-context.js';
import { type Result, err, ok } from '../../types/result.js';

export const DECLARED_CONTEXT_ARTIFACT_NAME = 'declared-context.json';

export class ComposerError extends Error {
  override readonly name = 'ComposerError';
}

export interface DeclaredContextSource {
  readonly kind: 'inventory_bootstrap' | 'ai_declared_intent';
  readonly path: string;
  readonly sha256: string;
}

export interface DeclaredContext {
  readonly observed_evidence: ObservedEvidence;
  readonly declared_intent: DeclaredIntent;
  readonly sources: readonly DeclaredContextSource[];
}

export interface BuildDeclaredContextOptions {
  readonly inventoryArtifactPath: string;
  readonly aiIntentArtifactPath?: string;
}

interface InventoryShape {
  readonly observed_evidence?: unknown;
  readonly declared_intent?: unknown;
}

interface AiIntentShape {
  readonly observed_evidence?: unknown;
  readonly declared_intent?: unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function buildDeclaredContext(
  options: BuildDeclaredContextOptions,
): Promise<Result<DeclaredContext, ComposerError>> {
  let inventoryText: string;
  try {
    inventoryText = await fs.readFile(options.inventoryArtifactPath, 'utf8');
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(
      new ComposerError(
        `failed to read inventory artifact at ${options.inventoryArtifactPath}: ${m}`,
      ),
    );
  }
  let inventory: InventoryShape;
  try {
    inventory = JSON.parse(inventoryText) as InventoryShape;
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new ComposerError(`inventory artifact is not valid JSON: ${m}`));
  }

  if (
    typeof inventory.observed_evidence !== 'object' ||
    inventory.observed_evidence === null
  ) {
    return err(
      new ComposerError(
        'inventory artifact missing `observed_evidence` field',
      ),
    );
  }
  // Field-by-owner: inventory MUST NOT carry `declared_intent`.
  if (inventory.declared_intent !== undefined) {
    return err(
      new ComposerError(
        'inventory artifact declared_intent field is forbidden — only ai-declared-intent.json may set it',
      ),
    );
  }

  const sources: DeclaredContextSource[] = [
    {
      kind: 'inventory_bootstrap',
      path: options.inventoryArtifactPath,
      sha256: sha256(inventoryText),
    },
  ];

  let declaredIntent: DeclaredIntent = {};

  if (options.aiIntentArtifactPath !== undefined) {
    let aiText: string;
    try {
      aiText = await fs.readFile(options.aiIntentArtifactPath, 'utf8');
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : String(cause);
      return err(
        new ComposerError(
          `failed to read AI intent artifact at ${options.aiIntentArtifactPath}: ${m}`,
        ),
      );
    }
    let aiArtifact: AiIntentShape;
    try {
      aiArtifact = JSON.parse(aiText) as AiIntentShape;
    } catch (cause) {
      const m = cause instanceof Error ? cause.message : String(cause);
      return err(
        new ComposerError(`AI intent artifact is not valid JSON: ${m}`),
      );
    }
    // Field-by-owner: AI MUST NOT carry `observed_evidence`.
    if (aiArtifact.observed_evidence !== undefined) {
      return err(
        new ComposerError(
          'AI intent artifact observed_evidence field is forbidden — only inventory-bootstrap.json may set it',
        ),
      );
    }
    if (
      typeof aiArtifact.declared_intent !== 'object' ||
      aiArtifact.declared_intent === null
    ) {
      return err(
        new ComposerError(
          'AI intent artifact missing `declared_intent` field',
        ),
      );
    }
    declaredIntent = aiArtifact.declared_intent as DeclaredIntent;
    sources.push({
      kind: 'ai_declared_intent',
      path: options.aiIntentArtifactPath,
      sha256: sha256(aiText),
    });
  }

  return ok({
    observed_evidence: inventory.observed_evidence as ObservedEvidence,
    declared_intent: declaredIntent,
    sources,
  });
}

export async function writeDeclaredContextArtifact(
  artifactDir: string,
  context: DeclaredContext,
): Promise<Result<string, ComposerError>> {
  const out = path.join(artifactDir, DECLARED_CONTEXT_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(out, JSON.stringify(context, null, 2), 'utf8');
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new ComposerError(`failed to write ${out}: ${m}`));
  }
}
