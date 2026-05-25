/**
 * Original product-understanding agent (step 17).
 *
 * This step's responsibilities have been split across 17b (deterministic
 * Bootstrap Inventory) and 17c (AI Product-Understanding + declared-
 * context composer). This module is the thin VeyraAgent wrapper that
 * orchestrates both halves and writes the final `declared-context.json`.
 *
 * Local-first (default): inventory bootstrap → composer.
 * MCP-enabled: bootstrap reaches Lovable/Supabase fetchers when
 *   provided; observed_evidence remains the inventory's exclusive field.
 * AI-enabled (--ai-provider + env var): AI Product-Understanding adds
 *   declared_intent, composer merges field-by-owner.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// NOTE (retro-17 f3-diff): productUnderstandingAgent imports the AI
// Product-Understanding helper functions from a sibling agent
// folder. Strict reading of §4.0 (agents do not import each other)
// would forbid this; the relaxed reading is that the imported items
// (`buildAiDeclaredIntent`, `writeAiDeclaredIntentArtifact`) are pure
// helper functions, not the sibling VeyraAgent's `.run()`. The
// preferred long-term architecture is for the orchestrator to run
// `createAiProductUnderstandingAgent()` as a separate registered
// agent and feed its artifact path into the composer; that split is
// noted as a follow-up and the current wrapper remains for backward
// compat with direct `productUnderstandingAgent.run()` calls in
// tests.
import {
  buildAiDeclaredIntent,
  writeAiDeclaredIntentArtifact,
} from '../ai-product-understanding/agent.js';
import {
  buildDeclaredContext,
  writeDeclaredContextArtifact,
} from '../../core/declared-context/builder.js';
import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { ArtifactRef } from '../../types/artifact.js';
import { isErr } from '../../types/result.js';

import {
  buildBootstrapInventory,
  writeInventoryArtifact,
  type BootstrapFs,
  type BootstrapMcpFetchers,
} from './inventory/bootstrap.js';
import type {
  AiProvider,
} from '../../ai/types.js';

const METADATA: AgentMetadata = {
  id: 'product-understanding',
  version: '0.1.0',
  declared_dependencies: ['inventory-bootstrap.json', 'ai-declared-intent.json'],
};

export interface ProductUnderstandingInput {
  readonly projectRoot: string;
  readonly fs?: BootstrapFs;
  readonly mcp?: BootstrapMcpFetchers;
  readonly supabaseProjectRef?: string;
  readonly lovableProjectId?: string;
  /**
   * Optional AI provider. When supplied, the agent runs the AI
   * Product-Understanding pass; otherwise the composer falls back to
   * the inventory alone (--no-ai path).
   */
  readonly aiProvider?: AiProvider;
  readonly aiModel?: string;
}

export interface ProductUnderstandingOutput {
  readonly inventoryArtifactPath: string;
  readonly aiIntentArtifactPath?: string;
  readonly declaredContextArtifactPath: string;
  readonly mode: 'no_ai' | 'ai_enabled';
}

export const productUnderstandingAgent: VeyraAgent<
  ProductUnderstandingInput,
  ProductUnderstandingOutput
> = {
  metadata: METADATA,
  async run(
    input: ProductUnderstandingInput,
    context: AgentExecutionContext,
  ): Promise<AgentResult<ProductUnderstandingOutput>> {
    const warnings: string[] = [];
    const artifacts: ArtifactRef[] = [];

    // 17b: deterministic Bootstrap Inventory.
    const bootR = await buildBootstrapInventory({
      projectRoot: input.projectRoot,
      ...(input.fs !== undefined ? { fs: input.fs } : {}),
      ...(input.mcp !== undefined ? { mcp: input.mcp } : {}),
      ...(input.supabaseProjectRef !== undefined
        ? { supabaseProjectRef: input.supabaseProjectRef }
        : {}),
      ...(input.lovableProjectId !== undefined
        ? { lovableProjectId: input.lovableProjectId }
        : {}),
      policy: context.policy,
    });
    if (isErr(bootR)) {
      warnings.push(`bootstrap failed: ${bootR.error.message}`);
      return {
        status: 'failed',
        artifacts,
        findings: [],
        warnings,
      };
    }
    const invWrite = await writeInventoryArtifact(
      context.artifactDir,
      bootR.value,
    );
    if (isErr(invWrite)) {
      warnings.push(`inventory write failed: ${invWrite.error.message}`);
      return {
        status: 'failed',
        artifacts,
        findings: [],
        warnings,
      };
    }
    artifacts.push({
      scanId: context.scanId,
      kind: 'evidence_inventory',
      path: invWrite.value,
    });

    // 17c: optional AI Product-Understanding pass.
    let aiIntentPath: string | undefined;
    if (input.aiProvider !== undefined) {
      const intentR = await buildAiDeclaredIntent({
        inventoryArtifactPath: invWrite.value,
        provider: input.aiProvider,
        model: input.aiModel ?? 'claude-sonnet-4-6',
      });
      if (isErr(intentR)) {
        warnings.push(`AI intent failed: ${intentR.error.message}`);
      } else {
        const writeR = await writeAiDeclaredIntentArtifact(
          context.artifactDir,
          intentR.value,
        );
        if (isErr(writeR)) {
          warnings.push(`AI intent write failed: ${writeR.error.message}`);
        } else {
          aiIntentPath = writeR.value;
          // Per retro-17 f4-diff: register the AI intent artifact
          // explicitly so the orchestrator's AgentResult.artifacts
          // surfaces it for downstream consumers.
          artifacts.push({
            scanId: context.scanId,
            kind: 'evidence_inventory',
            path: writeR.value,
          });
        }
      }
    }

    // Composer: sole writer of declared-context.json.
    const composeR = await buildDeclaredContext({
      inventoryArtifactPath: invWrite.value,
      ...(aiIntentPath !== undefined
        ? { aiIntentArtifactPath: aiIntentPath }
        : {}),
    });
    if (isErr(composeR)) {
      warnings.push(`composer failed: ${composeR.error.message}`);
      return {
        status: 'failed',
        artifacts,
        findings: [],
        warnings,
      };
    }
    const composeWrite = await writeDeclaredContextArtifact(
      context.artifactDir,
      composeR.value,
    );
    if (isErr(composeWrite)) {
      warnings.push(`declared-context write failed: ${composeWrite.error.message}`);
      return {
        status: 'failed',
        artifacts,
        findings: [],
        warnings,
      };
    }
    artifacts.push({
      scanId: context.scanId,
      kind: 'declared_context',
      path: composeWrite.value,
    });

    return {
      status: 'completed',
      artifacts,
      findings: [],
      warnings,
      output: {
        inventoryArtifactPath: invWrite.value,
        ...(aiIntentPath !== undefined
          ? { aiIntentArtifactPath: aiIntentPath }
          : {}),
        declaredContextArtifactPath: composeWrite.value,
        mode: aiIntentPath !== undefined ? 'ai_enabled' : 'no_ai',
      },
    };
  },
};
