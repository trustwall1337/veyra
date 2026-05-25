/**
 * AI Inference Agent (revision §3.2 + §7.2).
 *
 * Reads sanitized facts + declared context, produces `Hypothesis[]`.
 * Never produces Findings (constraint 7) or AIConcerns (Pass-2 owns those).
 * Optionally emits `ContextRequest`s for the orchestrator (18b) to route
 * through 08c's `ContextPolicyEvaluator` — the agent never calls the
 * evaluator directly (constraint 5).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { redactSecrets } from '../../ai/sanitization.js';
import type { AiRequest } from '../../ai/types.js';
import type { ContextRequest } from '../../types/context-request.js';
import type { Hypothesis } from '../../types/hypothesis.js';
import { type Result, err, ok } from '../../types/result.js';
import type { ScanFact } from '../../types/scan-fact.js';

import type {
  AiInferenceInput,
  AiInferenceLogEntry,
  AiInferenceOutput,
} from './types.js';

export const HYPOTHESES_ARTIFACT_NAME = 'hypotheses.json';
export const CONTEXT_REQUESTS_ARTIFACT_NAME = 'context-requests.json';

const DEFAULT_BUDGET = 100;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_SCHEMA_RETRIES = 2;

const HYPOTHESIS_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          proposed_control_id: { type: 'string' },
          proposed_finding_type: { enum: ['likely_issue', 'informational'] },
          evidence_refs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { fact_id: { type: 'string' } },
              required: ['fact_id'],
            },
            minItems: 1,
          },
          reasoning: { type: 'string' },
          confidence: { enum: ['low', 'medium', 'high'] },
          uncertainty_notes: { type: 'string' },
        },
        required: ['evidence_refs', 'reasoning', 'confidence', 'uncertainty_notes'],
      },
    },
  },
  required: ['hypotheses'],
};

const SYSTEM_PROMPT =
  'You are a security inference assistant. Given a list of observed ScanFacts and a sanitized declared context, propose hypotheses about possible launch-readiness issues. Each hypothesis MUST cite at least one fact_id from the input. Output only the JSON schema described. Use confidence low/medium/high; include uncertainty_notes for each. Never claim a finding is confirmed — that is the assertion layer\'s job.';

export class AiInferenceError extends Error {
  override readonly name = 'AiInferenceError';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildPrompt(
  facts: readonly ScanFact[],
  declaredContext?: Readonly<Record<string, unknown>>,
): string {
  const factSummaries = facts.map((f) => {
    const payload =
      f.source.kind === 'scanner_match'
        ? f.source.payload.sanitized_excerpt
        : f.source.kind === 'schema_element'
          ? (f.source.payload?.sanitized_excerpt ?? f.source.name)
          : f.source.kind === 'mcp_response'
            ? (f.source.payload?.sanitized_excerpt ?? f.source.tool)
            : 'local_file';
    return `- fact_id=${f.fact_id} kind=${f.source.kind} | ${payload}`;
  });
  const lines: string[] = ['Observed ScanFacts:'];
  lines.push(...factSummaries);
  if (declaredContext !== undefined) {
    lines.push('');
    lines.push('Declared context (sanitized):');
    lines.push(JSON.stringify(declaredContext));
  }
  return lines.join('\n');
}

function isValidFactId(
  candidate: { fact_id?: unknown } | unknown,
): candidate is { fact_id: string } {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { fact_id?: unknown }).fact_id === 'string'
  );
}

interface RawHypothesis {
  readonly proposed_control_id?: string;
  readonly proposed_finding_type?: 'likely_issue' | 'informational';
  readonly evidence_refs: readonly { readonly fact_id: string }[];
  readonly reasoning: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes: string;
  readonly requires_context?: ContextRequest;
}

function parseRawHypotheses(
  parsed: unknown,
): RawHypothesis[] | null {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { hypotheses?: unknown }).hypotheses)
  ) {
    return null;
  }
  const arr = (parsed as { hypotheses: unknown[] }).hypotheses;
  const out: RawHypothesis[] = [];
  for (const h of arr) {
    if (typeof h !== 'object' || h === null) return null;
    const obj = h as Record<string, unknown>;
    if (!Array.isArray(obj.evidence_refs) || obj.evidence_refs.length === 0) {
      return null;
    }
    if (!obj.evidence_refs.every(isValidFactId)) return null;
    if (typeof obj.reasoning !== 'string') return null;
    if (
      obj.confidence !== 'low' &&
      obj.confidence !== 'medium' &&
      obj.confidence !== 'high'
    ) {
      return null;
    }
    if (typeof obj.uncertainty_notes !== 'string') return null;
    out.push({
      ...(typeof obj.proposed_control_id === 'string'
        ? { proposed_control_id: obj.proposed_control_id }
        : {}),
      ...(obj.proposed_finding_type === 'likely_issue' ||
      obj.proposed_finding_type === 'informational'
        ? { proposed_finding_type: obj.proposed_finding_type }
        : {}),
      evidence_refs: obj.evidence_refs as readonly { readonly fact_id: string }[],
      reasoning: obj.reasoning,
      confidence: obj.confidence,
      uncertainty_notes: obj.uncertainty_notes,
    });
  }
  return out;
}

function validateAgainstFacts(
  raw: RawHypothesis,
  factIds: ReadonlySet<string>,
): boolean {
  if (raw.evidence_refs.length === 0) return false;
  for (const ref of raw.evidence_refs) {
    if (!factIds.has(ref.fact_id)) return false;
  }
  return true;
}

function emit(
  log: ((e: AiInferenceLogEntry) => void) | undefined,
  entry: AiInferenceLogEntry,
): void {
  if (log === undefined) return;
  log(entry);
}

export async function runAiInference(
  input: AiInferenceInput,
): Promise<Result<AiInferenceOutput, AiInferenceError>> {
  const budget = input.hypothesisBudget ?? DEFAULT_BUDGET;
  const factIds = new Set(input.scanFacts.map((f) => f.fact_id));
  const promptBody = redactSecrets(
    buildPrompt(input.scanFacts, input.declaredContext),
  );

  let attempt = 0;
  let parsed: unknown;
  let lastError: string | undefined;
  let schemaViolations = 0;

  while (attempt <= MAX_SCHEMA_RETRIES) {
    const stricterReminder =
      attempt === 0
        ? ''
        : ` Previous attempt produced output that did not match the schema (${lastError ?? 'unknown'}). This time match the schema exactly: ${JSON.stringify(HYPOTHESIS_SCHEMA)}`;
    const systemMessage = redactSecrets(SYSTEM_PROMPT + stricterReminder);

    const request: AiRequest = {
      model_id: input.model,
      system: systemMessage,
      messages: [{ role: 'user', content: promptBody }],
      max_output_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      response_schema: HYPOTHESIS_SCHEMA,
    };

    const aiResult = await input.provider.complete(request);
    if (!aiResult.ok) {
      return err(new AiInferenceError(`AI provider call failed: ${aiResult.error.message}`));
    }
    parsed = aiResult.value.parsed_output;
    const candidate = parseRawHypotheses(parsed);
    if (candidate === null) {
      schemaViolations += 1;
      emit(input.actionLog, { event: 'schema_violation', attempt: attempt + 1 });
      lastError = 'schema parse failed';
      attempt += 1;
      continue;
    }
    // All hypotheses must cite known fact_ids; reject any that don't.
    const validRaws = candidate.filter((r) => validateAgainstFacts(r, factIds));
    if (validRaws.length !== candidate.length) {
      schemaViolations += 1;
      emit(input.actionLog, { event: 'schema_violation', attempt: attempt + 1 });
      lastError = 'one or more hypotheses cited unknown fact_ids';
      attempt += 1;
      continue;
    }
    // Trim to budget.
    let budgetExhausted = false;
    let kept = validRaws;
    if (kept.length > budget) {
      kept = kept.slice(0, budget);
      budgetExhausted = true;
      emit(input.actionLog, { event: 'budget_exhausted', cap: budget });
    }

    const modelId = aiResult.value.model_id;
    const promptFingerprint = sha256(
      JSON.stringify({ system: systemMessage as string, body: promptBody as string }),
    );
    const hypotheses: Hypothesis[] = kept.map((r, i) => ({
      hypothesis_id: sha256(`${promptFingerprint}:${String(i)}:${r.reasoning}`),
      source: 'ai_inference',
      ...(r.proposed_control_id !== undefined
        ? { proposed_control_id: r.proposed_control_id }
        : {}),
      ...(r.proposed_finding_type !== undefined
        ? { proposed_finding_type: r.proposed_finding_type }
        : {}),
      evidence_refs: r.evidence_refs,
      reasoning: r.reasoning,
      confidence: r.confidence,
      uncertainty_notes: r.uncertainty_notes,
      model_id: modelId,
      prompt_fingerprint_sha256: promptFingerprint,
    }));

    const contextRequests: ContextRequest[] = [];
    for (const r of kept) {
      if (r.requires_context !== undefined) {
        contextRequests.push(r.requires_context);
      }
    }

    return ok({
      hypotheses,
      contextRequests,
      budgetExhausted,
      schemaViolations,
    });
  }
  // Cap reached → discard.
  emit(input.actionLog, {
    event: 'discarded_after_retries',
    attempts: attempt,
  });
  return ok({
    hypotheses: [],
    contextRequests: [],
    budgetExhausted: false,
    schemaViolations,
  });
}

export async function writeHypothesesArtifact(
  artifactDir: string,
  output: AiInferenceOutput,
): Promise<Result<string, AiInferenceError>> {
  const out = path.join(artifactDir, HYPOTHESES_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      out,
      JSON.stringify({ hypotheses: output.hypotheses }, null, 2),
      'utf8',
    );
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new AiInferenceError(`failed to write ${out}: ${m}`));
  }
}

export async function writeContextRequestsArtifact(
  artifactDir: string,
  output: AiInferenceOutput,
): Promise<Result<string, AiInferenceError>> {
  const out = path.join(artifactDir, CONTEXT_REQUESTS_ARTIFACT_NAME);
  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      out,
      JSON.stringify(
        { context_requests: output.contextRequests },
        null,
        2,
      ),
      'utf8',
    );
    return ok(out);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(new AiInferenceError(`failed to write ${out}: ${m}`));
  }
}
