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

const REQUIRES_CONTEXT_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    justification: { type: 'string' },
    args: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { const: 'read_file' },
            path: { type: 'string' },
            line_range: {
              type: 'object',
              additionalProperties: false,
              properties: {
                start: { type: 'integer', minimum: 1 },
                end: { type: 'integer', minimum: 1 },
              },
              required: ['start', 'end'],
            },
          },
          required: ['kind', 'path'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { const: 'list_files' },
            scope: { type: 'string' },
          },
          required: ['kind', 'scope'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { const: 'get_supabase_table_meta' },
            table_names: { type: 'array', items: { type: 'string' } },
          },
          required: ['kind'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { const: 'get_supabase_advisors' } },
          required: ['kind'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { const: 'send_message_template' },
            template_id: { type: 'string' },
            slots: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['kind', 'template_id'],
        },
      ],
    },
  },
  required: ['justification', 'args'],
};

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
          requires_context: REQUIRES_CONTEXT_SCHEMA,
        },
        required: ['evidence_refs', 'reasoning', 'confidence', 'uncertainty_notes'],
      },
    },
  },
  required: ['hypotheses'],
};

const ALLOWED_HYPOTHESIS_KEYS = new Set([
  'proposed_control_id',
  'proposed_finding_type',
  'evidence_refs',
  'reasoning',
  'confidence',
  'uncertainty_notes',
  'requires_context',
]);

const ALLOWED_REF_KEYS = new Set(['fact_id']);

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

interface RawRequiresContext {
  readonly justification: string;
  readonly args: ContextRequest['args'];
}

interface RawHypothesis {
  readonly proposed_control_id?: string;
  readonly proposed_finding_type?: 'likely_issue' | 'informational';
  readonly evidence_refs: readonly { readonly fact_id: string }[];
  readonly reasoning: string;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly uncertainty_notes: string;
  readonly requires_context?: RawRequiresContext;
}

function isValidContextRequestArgs(
  v: unknown,
): v is ContextRequest['args'] {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  switch (r.kind) {
    case 'read_file': {
      const allowed = new Set(['kind', 'path', 'line_range']);
      for (const k of Object.keys(r)) {
        if (!allowed.has(k)) return false;
      }
      if (typeof r.path !== 'string') return false;
      if (r.line_range !== undefined) {
        const lr = r.line_range;
        if (typeof lr !== 'object' || lr === null) return false;
        const lrr = lr as Record<string, unknown>;
        const lrAllowed = new Set(['start', 'end']);
        for (const k of Object.keys(lrr)) {
          if (!lrAllowed.has(k)) return false;
        }
        if (typeof lrr.start !== 'number' || !Number.isInteger(lrr.start) || lrr.start < 1) {
          return false;
        }
        if (typeof lrr.end !== 'number' || !Number.isInteger(lrr.end) || lrr.end < 1) {
          return false;
        }
      }
      return true;
    }
    case 'list_files': {
      const allowed = new Set(['kind', 'scope']);
      for (const k of Object.keys(r)) {
        if (!allowed.has(k)) return false;
      }
      return typeof r.scope === 'string';
    }
    case 'get_supabase_table_meta': {
      const allowed = new Set(['kind', 'table_names']);
      for (const k of Object.keys(r)) {
        if (!allowed.has(k)) return false;
      }
      if (r.table_names !== undefined) {
        if (!Array.isArray(r.table_names)) return false;
        if (!r.table_names.every((x) => typeof x === 'string')) return false;
      }
      return true;
    }
    case 'get_supabase_advisors': {
      const allowed = new Set(['kind']);
      for (const k of Object.keys(r)) {
        if (!allowed.has(k)) return false;
      }
      return true;
    }
    case 'send_message_template': {
      const allowed = new Set(['kind', 'template_id', 'slots']);
      for (const k of Object.keys(r)) {
        if (!allowed.has(k)) return false;
      }
      if (typeof r.template_id !== 'string') return false;
      if (r.slots !== undefined) {
        if (typeof r.slots !== 'object' || r.slots === null) return false;
        for (const v2 of Object.values(r.slots)) {
          if (typeof v2 !== 'string') return false;
        }
      }
      return true;
    }
    default:
      return false;
  }
}

function parseRawHypotheses(
  parsed: unknown,
): RawHypothesis[] | null {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  const root = parsed as Record<string, unknown>;
  // Strict unknown-field rejection at the root.
  for (const k of Object.keys(root)) {
    if (k !== 'hypotheses') return null;
  }
  if (!Array.isArray(root.hypotheses)) return null;
  const arr = root.hypotheses as unknown[];
  const out: RawHypothesis[] = [];
  for (const h of arr) {
    if (typeof h !== 'object' || h === null) return null;
    const obj = h as Record<string, unknown>;
    // Strict unknown-field rejection at the hypothesis level.
    for (const k of Object.keys(obj)) {
      if (!ALLOWED_HYPOTHESIS_KEYS.has(k)) return null;
    }
    if (!Array.isArray(obj.evidence_refs) || obj.evidence_refs.length === 0) {
      return null;
    }
    for (const ref of obj.evidence_refs) {
      if (typeof ref !== 'object' || ref === null) return null;
      const refObj = ref as Record<string, unknown>;
      for (const k of Object.keys(refObj)) {
        if (!ALLOWED_REF_KEYS.has(k)) return null;
      }
      if (!isValidFactId(ref)) return null;
    }
    if (typeof obj.reasoning !== 'string') return null;
    if (
      obj.confidence !== 'low' &&
      obj.confidence !== 'medium' &&
      obj.confidence !== 'high'
    ) {
      return null;
    }
    if (typeof obj.uncertainty_notes !== 'string') return null;
    let rc: RawRequiresContext | undefined;
    if (obj.requires_context !== undefined) {
      const candidate = obj.requires_context;
      if (typeof candidate !== 'object' || candidate === null) return null;
      const cr = candidate as Record<string, unknown>;
      const rcAllowed = new Set(['justification', 'args']);
      for (const k of Object.keys(cr)) {
        if (!rcAllowed.has(k)) return null;
      }
      if (typeof cr.justification !== 'string') return null;
      if (!isValidContextRequestArgs(cr.args)) return null;
      rc = {
        justification: cr.justification,
        args: cr.args,
      };
    }
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
      ...(rc !== undefined ? { requires_context: rc } : {}),
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
  const budgetRaw = input.hypothesisBudget ?? DEFAULT_BUDGET;
  if (!Number.isInteger(budgetRaw) || budgetRaw < 0) {
    return err(
      new AiInferenceError(
        `hypothesisBudget must be a non-negative integer, got ${String(budgetRaw)}`,
      ),
    );
  }
  const budget = budgetRaw;
  const factIds = new Set(input.scanFacts.map((f) => f.fact_id));
  const promptBody = redactSecrets(
    buildPrompt(input.scanFacts, input.declaredContext),
  );

  let attempt = 0;
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
    const candidate = parseRawHypotheses(aiResult.value.parsed_output);
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
    // Per retro-08d: AI-produced text fields are run through
    // redactSecrets before persistence, even though the prompt was
    // sanitized — the model could echo or invent a secret-like
    // pattern and the hard rule forbids raw secrets in any artifact.
    const hypothesesAndRequests: { h: Hypothesis; cr?: ContextRequest }[] = kept.map(
      (r, i) => {
        const hypId = sha256(`${promptFingerprint}:${String(i)}:${r.reasoning}`);
        let cr: ContextRequest | undefined;
        if (r.requires_context !== undefined) {
          const requestId = sha256(`${hypId}:${JSON.stringify(r.requires_context.args)}`);
          const args = r.requires_context.args;
          const safeJustification = redactSecrets(r.requires_context.justification) as string;
          cr = {
            request_id: requestId,
            for_hypothesis_id: hypId,
            justification: safeJustification,
            kind: args.kind,
            args,
          } as ContextRequest;
        }
        const h: Hypothesis = {
          hypothesis_id: hypId,
          source: 'ai_inference',
          ...(r.proposed_control_id !== undefined
            ? { proposed_control_id: redactSecrets(r.proposed_control_id) }
            : {}),
          ...(r.proposed_finding_type !== undefined
            ? { proposed_finding_type: r.proposed_finding_type }
            : {}),
          evidence_refs: r.evidence_refs,
          reasoning: redactSecrets(r.reasoning),
          confidence: r.confidence,
          uncertainty_notes: redactSecrets(r.uncertainty_notes),
          model_id: modelId,
          prompt_fingerprint_sha256: promptFingerprint,
          ...(cr !== undefined ? { requires_context: cr } : {}),
        };
        return cr !== undefined ? { h, cr } : { h };
      },
    );
    const hypotheses: Hypothesis[] = hypothesesAndRequests.map((x) => x.h);
    const contextRequests: ContextRequest[] = hypothesesAndRequests
      .map((x) => x.cr)
      .filter((c): c is ContextRequest => c !== undefined);

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

// ── Optional VeyraAgent wrapper ────────────────────────────────────
// Constructed only when the orchestrator (18b) wires the AI provider
// under the §12b opt-in matrix. When --no-ai is set or the provider
// env var is missing, the orchestrator skips construction entirely —
// no Anthropic SDK import path is reached.

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { AiProvider } from '../../ai/types.js';
import type { ArtifactRef } from '../../types/artifact.js';

export interface AiInferenceAgentInput {
  readonly scanFactsArtifactPath: string;
  readonly declaredContextArtifactPath?: string;
  readonly provider: AiProvider;
  readonly model: string;
  readonly hypothesisBudget?: number;
}

export interface AiInferenceAgentOutput {
  readonly hypothesesArtifactPath: string;
  readonly contextRequestsArtifactPath: string;
  readonly hypothesesCount: number;
  readonly contextRequestsCount: number;
  readonly budgetExhausted: boolean;
}

const AGENT_METADATA: AgentMetadata = {
  id: 'ai-inference',
  version: '0.1.0',
  declared_dependencies: ['scan-facts.json', 'declared-context.json'],
};

interface ScanFactsArtifact {
  readonly scan_facts?: readonly ScanFact[];
}

interface DeclaredContextArtifact {
  readonly observed_evidence?: Readonly<Record<string, unknown>>;
  readonly declared_intent?: Readonly<Record<string, unknown>>;
}

async function readScanFacts(
  artifactPath: string,
): Promise<Result<readonly ScanFact[], AiInferenceError>> {
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as ScanFactsArtifact;
    if (!Array.isArray(parsed.scan_facts)) {
      return err(
        new AiInferenceError(
          `scan-facts artifact at ${artifactPath} missing scan_facts array`,
        ),
      );
    }
    return ok(parsed.scan_facts);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(
      new AiInferenceError(
        `failed to read scan-facts at ${artifactPath}: ${m}`,
      ),
    );
  }
}

async function readDeclaredContext(
  artifactPath: string,
): Promise<Result<Readonly<Record<string, unknown>>, AiInferenceError>> {
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as DeclaredContextArtifact;
    return ok(parsed as Readonly<Record<string, unknown>>);
  } catch (cause) {
    const m = cause instanceof Error ? cause.message : String(cause);
    return err(
      new AiInferenceError(
        `failed to read declared-context at ${artifactPath}: ${m}`,
      ),
    );
  }
}

export function createAiInferenceAgent(): VeyraAgent<
  AiInferenceAgentInput,
  AiInferenceAgentOutput
> {
  return {
    metadata: AGENT_METADATA,
    async run(
      input: AiInferenceAgentInput,
      context: AgentExecutionContext,
    ): Promise<AgentResult<AiInferenceAgentOutput>> {
      const factsR = await readScanFacts(input.scanFactsArtifactPath);
      if (!factsR.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_inference_read_facts_failed: ${factsR.error.message}`],
        };
      }
      let declaredContext: Readonly<Record<string, unknown>> | undefined;
      if (input.declaredContextArtifactPath !== undefined) {
        const dcR = await readDeclaredContext(input.declaredContextArtifactPath);
        if (!dcR.ok) {
          return {
            status: 'completed',
            artifacts: [],
            findings: [],
            warnings: [`ai_inference_read_declared_context_failed: ${dcR.error.message}`],
          };
        }
        declaredContext = dcR.value;
      }
      const inferOptions: AiInferenceInput = {
        scanFacts: factsR.value,
        provider: input.provider,
        model: input.model,
        ...(declaredContext !== undefined ? { declaredContext } : {}),
        ...(input.hypothesisBudget !== undefined
          ? { hypothesisBudget: input.hypothesisBudget }
          : {}),
      };
      const r = await runAiInference(inferOptions);
      if (!r.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_inference_run_failed: ${r.error.message}`],
        };
      }
      const hW = await writeHypothesesArtifact(context.artifactDir, r.value);
      if (!hW.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_inference_write_hypotheses_failed: ${hW.error.message}`],
        };
      }
      const crW = await writeContextRequestsArtifact(context.artifactDir, r.value);
      if (!crW.ok) {
        return {
          status: 'completed',
          artifacts: [],
          findings: [],
          warnings: [`ai_inference_write_context_requests_failed: ${crW.error.message}`],
        };
      }
      const artifacts: ArtifactRef[] = [
        { scanId: context.scanId, kind: 'hypotheses', path: hW.value },
        { scanId: context.scanId, kind: 'context_requests', path: crW.value },
      ];
      // Constraint 7: findings is ALWAYS empty for the AI inference agent.
      return {
        status: 'completed',
        artifacts,
        findings: [],
        warnings: [],
        output: {
          hypothesesArtifactPath: hW.value,
          contextRequestsArtifactPath: crW.value,
          hypothesesCount: r.value.hypotheses.length,
          contextRequestsCount: r.value.contextRequests.length,
          budgetExhausted: r.value.budgetExhausted,
        },
      };
    },
  };
}
