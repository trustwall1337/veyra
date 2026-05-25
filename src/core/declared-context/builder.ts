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

/**
 * Deterministic fallback for `declared_intent` when AI is not opted
 * into (or has no artifact). Pulls weak signals from
 * `observed_evidence` so the report still has _something_ to show
 * under the declared-intent tier. Every value is `confidence: 'low'`
 * because no AI inference touched these.
 */
function deriveFallbackIntent(
  evidence: Record<string, unknown>,
): DeclaredIntent {
  const intent: Record<string, unknown> = {};

  const pkg = evidence.package_json_digest as
    | { name?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    | undefined;
  const framework = evidence.framework as string | undefined;
  const routes = Array.isArray(evidence.routes)
    ? (evidence.routes as string[])
    : [];
  const tables = (evidence.supabase_schema as { tables?: string[] } | undefined)?.tables ?? [];
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };

  const pkgName = typeof pkg?.name === 'string' ? pkg.name : undefined;
  if (pkgName !== undefined || framework !== undefined) {
    const purposeBits: string[] = [];
    if (pkgName !== undefined) purposeBits.push(`Project "${pkgName}"`);
    if (framework !== undefined && framework !== 'unknown') {
      purposeBits.push(`built on ${framework}`);
    }
    if (purposeBits.length > 0) {
      intent.purpose = {
        value: purposeBits.join(' '),
        confidence: 'low',
        uncertainty_notes:
          'derived from inventory only (--no-ai fallback); not AI-inferred',
      };
    }
  }

  const roles = new Set<string>();
  for (const r of routes) {
    if (/admin/i.test(r)) roles.add('admin');
    if (/dashboard|profile|account/i.test(r)) roles.add('user');
  }
  if (roles.size > 0) {
    intent.user_roles = {
      value: Array.from(roles).sort(),
      confidence: 'low',
      uncertainty_notes:
        'derived from route patterns in inventory only (--no-ai fallback)',
    };
  }

  const dataKinds = new Set<string>();
  for (const t of tables) {
    const low = t.toLowerCase();
    if (/users|accounts|profile/.test(low)) dataKinds.add('user_profile');
    if (/orders|invoices|payments|subscriptions/.test(low)) dataKinds.add('payment');
    if (/documents|files|attachments/.test(low)) dataKinds.add('file');
    if (/tenants|workspaces/.test(low)) dataKinds.add('tenant');
  }
  if ('stripe' in deps || '@stripe/stripe-js' in deps) dataKinds.add('payment');
  if (dataKinds.size > 0) {
    intent.data_kinds = {
      value: Array.from(dataKinds).sort(),
      confidence: 'low',
      uncertainty_notes:
        'derived from Supabase tables + deps in inventory only',
    };
  }

  if ('@supabase/supabase-js' in deps) {
    intent.auth_model = {
      value: 'Supabase Auth (inferred from dependency only — not AI-inferred)',
      confidence: 'low',
      uncertainty_notes:
        'derived from package.json dependency only (--no-ai fallback)',
    };
  }

  return intent;
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

  // --no-ai fallback: derive declared_intent deterministically from
  // inventory hints when the AI artifact is not provided. Per step
  // 17c: "declared_intent falls back to the Lovable `send_message`
  // raw responses (if MCP is enabled) or to a minimal filename-
  // derived inference produced deterministically by the Bootstrap
  // Inventory itself."
  let declaredIntent: DeclaredIntent = deriveFallbackIntent(
    inventory.observed_evidence as Record<string, unknown>,
  );

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
    declaredIntent = aiArtifact.declared_intent;
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
