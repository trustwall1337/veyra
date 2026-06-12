/**
 * Project briefing synthesizer (Phase 3 / Step 40d). Two paths:
 *
 *  - `synthesizeAiAssisted` — one Bedrock call via the briefing-specific
 *    {@link BriefingBedrockCaller}, debited from the existing loop budget
 *    BEFORE invocation and hard-capped at one call (V14). The AI return is
 *    re-validated by `validate.ts`; structural fields the caller already
 *    knows (framework, key_deps) are merged onto the AI fields.
 *
 *  - `synthesizeStructuralOnly` — no AI call, no budget debit. Pure
 *    derivation from inventory + optional schema-meta + optional lockfile.
 *    AI-only fields fall back to `confidence: 'low'` with
 *    `uncertainty_notes: 'no_ai_synthesis'`.
 *
 * On AI-path failure (call error, schema violation, classification-key
 * smuggling, budget exhaustion), the synthesizer falls back to a
 * `degraded_fallback` briefing (Decision E) so the loop keeps running.
 */

import { createHash } from 'node:crypto';

import { err, ok, type Result } from '../../types/result.js';
import type { BudgetLike } from '../../core/orchestrator/loop-budget.js';
import type { InventoryBootstrap } from '../../agents/product-understanding/inventory/types.js';

import {
  buildBriefingSystemPrompt,
  buildBriefingUserPrompt,
  type BriefingLockfileSummary,
  type BriefingSchemaMeta,
  type BriefingScannerCounts,
} from './prompt.js';
import { validateAiBriefingReturn } from './validate.js';
import {
  BriefingSynthesisError,
  type BriefingBedrockCaller,
  type BriefingBedrockRequest,
  type BriefingDependencySurface,
  type BriefingListField,
  type BriefingScalarField,
  type ProjectBriefing,
} from './types.js';

/** Default token-cost approximation for one briefing call. */
export const DEFAULT_BRIEFING_COST_UNITS = 4_000;

export const BRIEFING_MAX_OUTPUT_TOKENS = 1500;

/** AI tool-use schema fragment for the briefing return (JSON Schema). */
const BRIEFING_RESPONSE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'purpose',
    'user_roles',
    'data_kinds',
    'auth_model',
    'sensitive_tables',
    'dependency_surface',
    'observed_trust_boundaries',
  ],
  properties: {
    purpose: scalarFieldJsonSchema(),
    user_roles: listFieldJsonSchema(),
    data_kinds: listFieldJsonSchema(),
    auth_model: scalarFieldJsonSchema(),
    sensitive_tables: listFieldJsonSchema(),
    dependency_surface: {
      type: 'object',
      additionalProperties: false,
      required: ['framework', 'key_deps', 'confidence'],
      properties: {
        framework: { type: 'string' },
        key_deps: { type: 'array', items: { type: 'string' } },
        confidence: { enum: ['low', 'medium', 'high'] },
        uncertainty_notes: { type: 'string' },
      },
    },
    observed_trust_boundaries: listFieldJsonSchema(),
  },
};

function scalarFieldJsonSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence'],
    properties: {
      value: { type: 'string' },
      confidence: { enum: ['low', 'medium', 'high'] },
      uncertainty_notes: { type: 'string' },
    },
  };
}

function listFieldJsonSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence'],
    properties: {
      value: { type: 'array', items: { type: 'string' } },
      confidence: { enum: ['low', 'medium', 'high'] },
      uncertainty_notes: { type: 'string' },
    },
  };
}

export interface SynthesizeProjectBriefingInput {
  readonly inventory: InventoryBootstrap;
  readonly schemaMeta?: BriefingSchemaMeta;
  readonly lockfile?: BriefingLockfileSummary;
  readonly scannerCounts?: BriefingScannerCounts;
  readonly aiOptIn: boolean;
  readonly bedrockCaller?: BriefingBedrockCaller;
  readonly modelId?: string;
  /** Frozen clock for V1 determinism (defaults to `Date.now`). */
  readonly now?: () => number;
  /** Optional loop budget; the AI path debits one tool-call + cost-units BEFORE invocation. */
  readonly loopBudget?: BudgetLike;
  /** Override cost units; defaults to {@link DEFAULT_BRIEFING_COST_UNITS}. */
  readonly costUnits?: number;
  /**
   * Test-only hard cap on AI calls per synthesizer instance. Defaults to 1
   * (V14: one call hard). A second call attempt returns
   * `degraded_fallback` without firing.
   */
  readonly maxAiCalls?: number;
}

/**
 * One-shot project-briefing synthesis. Returns `ok(briefing)` on the
 * happy path AND on the degraded-fallback path; the caller distinguishes
 * via `briefing.synthesis_mode`. Returns `err` only when the input is
 * structurally unusable (no inventory).
 */
export async function synthesizeProjectBriefing(
  input: SynthesizeProjectBriefingInput,
): Promise<Result<ProjectBriefing, BriefingSynthesisError>> {
  if (input.inventory === undefined || input.inventory === null) {
    return err(
      new BriefingSynthesisError(
        'briefing synthesis received no inventory',
        'inventory_unavailable',
      ),
    );
  }
  if (!input.aiOptIn || input.bedrockCaller === undefined) {
    return ok(buildStructuralOnly(input, 'structural_only'));
  }

  // V14: enforce the one-call hard cap. The synthesizer is a one-shot
  // helper, but tests may call it twice against the same budget — the
  // second call must NOT fire a Bedrock request and must NOT debit the
  // budget a second time.
  const maxCalls = input.maxAiCalls ?? 1;
  const counter = aiCallCounter(input);
  if (counter.value >= maxCalls) {
    return ok(buildStructuralOnly(input, 'degraded_fallback'));
  }

  // V14: pre-call budget gate. If the budget has zero remaining tool
  // calls or zero remaining cost, route to structural-only WITHOUT a
  // call and WITHOUT a debit.
  if (input.loopBudget !== undefined) {
    const tripped = input.loopBudget.exceeded();
    if (tripped !== undefined) {
      return ok(buildStructuralOnly(input, 'structural_only'));
    }
    // Debit BEFORE invocation so a transport failure still counts as a
    // call attempted (Step 31 invariant: budget burns on all outcomes).
    input.loopBudget.countToolCall();
    input.loopBudget.addCost(input.costUnits ?? DEFAULT_BRIEFING_COST_UNITS);
  }
  counter.value += 1;

  const aiResult = await invokeBriefingAi(input);
  if (!aiResult.ok) {
    return ok(buildDegradedFallback(input, aiResult.error));
  }

  return ok(aiResult.value);
}

interface AiCallCounter {
  value: number;
}

const COUNTER_BY_BUDGET = new WeakMap<object, AiCallCounter>();

function aiCallCounter(input: SynthesizeProjectBriefingInput): AiCallCounter {
  // The one-call hard cap is scoped per-budget so tests can reuse the
  // synthesizer module against multiple isolated budgets. Falls back to
  // a per-caller closure when no budget is supplied.
  if (input.loopBudget !== undefined) {
    const key = input.loopBudget as unknown as object;
    let counter = COUNTER_BY_BUDGET.get(key);
    if (counter === undefined) {
      counter = { value: 0 };
      COUNTER_BY_BUDGET.set(key, counter);
    }
    return counter;
  }
  return { value: 0 };
}

/** Run the AI path; returns either the validated briefing or an error. */
async function invokeBriefingAi(
  input: SynthesizeProjectBriefingInput,
): Promise<Result<ProjectBriefing, BriefingSynthesisError>> {
  if (input.bedrockCaller === undefined || input.modelId === undefined) {
    return err(
      new BriefingSynthesisError(
        'briefing AI path invoked without bedrockCaller or modelId',
        'unknown',
      ),
    );
  }
  const user = buildBriefingUserPrompt({
    inventory: input.inventory,
    ...(input.schemaMeta !== undefined ? { schemaMeta: input.schemaMeta } : {}),
    ...(input.lockfile !== undefined ? { lockfile: input.lockfile } : {}),
    ...(input.scannerCounts !== undefined
      ? { scannerCounts: input.scannerCounts }
      : {}),
  });
  const system = buildBriefingSystemPrompt();
  const request: BriefingBedrockRequest = {
    model_id: input.modelId,
    system,
    user,
    max_output_tokens: BRIEFING_MAX_OUTPUT_TOKENS,
    response_schema: BRIEFING_RESPONSE_SCHEMA,
  };

  let response;
  try {
    response = await input.bedrockCaller.complete(request);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new BriefingSynthesisError(`bedrock briefing call failed: ${m}`, 'ai_call_failed'));
  }

  const validated = validateAiBriefingReturn(response.parsed_output);
  if (!validated.ok) return err(validated.error);

  const now = input.now ?? Date.now;
  const briefing: ProjectBriefing = {
    purpose: validated.value.purpose,
    user_roles: validated.value.user_roles,
    data_kinds: validated.value.data_kinds,
    auth_model: validated.value.auth_model,
    sensitive_tables: validated.value.sensitive_tables,
    dependency_surface: mergeDependencySurface(
      validated.value.dependency_surface,
      input,
    ),
    observed_trust_boundaries: validated.value.observed_trust_boundaries,
    synthesis_mode: 'ai_assisted',
    model_id: response.model_id,
    ...(response.prompt_fingerprint_sha256 !== undefined
      ? { prompt_fingerprint_sha256: response.prompt_fingerprint_sha256 }
      : { prompt_fingerprint_sha256: computePromptFingerprint(request) }),
    recorded_at: new Date(now()).toISOString(),
  };
  return ok(briefing);
}

function computePromptFingerprint(request: BriefingBedrockRequest): string {
  // sha256 over the structural body fields only (omitting `max_output_tokens`
  // changes nothing because it is fixed; recorded for audit).
  const canonical = JSON.stringify({
    model_id: request.model_id,
    system: request.system as unknown as string,
    user: request.user as unknown as string,
    response_schema: request.response_schema,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Merge the AI's `dependency_surface` with structural inventory/lockfile inputs. */
function mergeDependencySurface(
  aiSurface: BriefingDependencySurface,
  input: SynthesizeProjectBriefingInput,
): BriefingDependencySurface {
  const structuralFramework = input.inventory.observed_evidence.framework;
  const structuralKeys =
    input.lockfile !== undefined && input.lockfile.key_deps.length > 0
      ? input.lockfile.key_deps
      : aiSurface.key_deps;
  return {
    framework: structuralFramework,
    key_deps: structuralKeys,
    confidence: aiSurface.confidence,
    ...(aiSurface.uncertainty_notes !== undefined
      ? { uncertainty_notes: aiSurface.uncertainty_notes }
      : {}),
  };
}

function buildStructuralOnly(
  input: SynthesizeProjectBriefingInput,
  mode: 'structural_only' | 'degraded_fallback',
): ProjectBriefing {
  const now = input.now ?? Date.now;
  const ev = input.inventory.observed_evidence;
  const lockKeys = input.lockfile?.key_deps ?? [];
  const tables = uniqueTableList(
    ev.supabase_schema?.tables,
    input.schemaMeta?.tables,
  );

  const purpose: BriefingScalarField = {
    value: 'unknown',
    confidence: 'low',
    uncertainty_notes: 'no_ai_synthesis',
  };
  const userRoles: BriefingListField = {
    value: [],
    confidence: 'low',
    uncertainty_notes: 'no_ai_synthesis',
  };
  const dataKinds: BriefingListField = {
    value: [],
    confidence: 'low',
    uncertainty_notes: 'no_ai_synthesis',
  };
  const authModel: BriefingScalarField = {
    value: 'unknown',
    confidence: 'low',
    uncertainty_notes: 'no_ai_synthesis',
  };
  const sensitiveTables: BriefingListField =
    tables.length === 0
      ? {
          value: [],
          confidence: 'low',
          uncertainty_notes: 'schema_meta_not_yet_observed',
        }
      : {
          value: tables,
          confidence: 'low',
          uncertainty_notes: 'no_ai_synthesis',
        };
  const dependencySurface: BriefingDependencySurface = {
    framework: ev.framework,
    key_deps: lockKeys,
    confidence: 'medium',
    uncertainty_notes: 'no_ai_synthesis',
  };
  const observedTrustBoundaries: BriefingListField = {
    value: [],
    confidence: 'low',
    uncertainty_notes: 'no_ai_synthesis',
  };

  return {
    purpose,
    user_roles: userRoles,
    data_kinds: dataKinds,
    auth_model: authModel,
    sensitive_tables: sensitiveTables,
    dependency_surface: dependencySurface,
    observed_trust_boundaries: observedTrustBoundaries,
    synthesis_mode: mode,
    recorded_at: new Date(now()).toISOString(),
  };
}

function buildDegradedFallback(
  input: SynthesizeProjectBriefingInput,
  reason: BriefingSynthesisError,
): ProjectBriefing {
  const fallback = buildStructuralOnly(input, 'degraded_fallback');
  // Encode the failure reason on `purpose.uncertainty_notes` so the
  // operator can see why the AI path was skipped. Reason string is
  // already redacted by virtue of NEVER containing secrets — it's an
  // error class name plus a transport message.
  const reasonNote = `ai_synthesis_failed:${reason.kind}`;
  return {
    ...fallback,
    purpose: {
      ...fallback.purpose,
      uncertainty_notes: reasonNote,
    },
  };
}

function uniqueTableList(
  a?: readonly string[],
  b?: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [a ?? [], b ?? []]) {
    for (const t of list) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

/** Recorded-fixture caller for tests: returns a queued response then exhausts. */
export function recordedBriefingBedrockCaller(
  responses: readonly { readonly parsed_output: unknown; readonly model_id: string; readonly prompt_fingerprint_sha256?: string; readonly cost_units?: number }[],
): BriefingBedrockCaller {
  const queue = [...responses];
  return {
    complete: async () => {
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('briefing bedrock recording exhausted');
      }
      return next;
    },
  };
}
