import { createHash } from 'node:crypto';

import type { ToolDescriptorView } from '../../core/tools/descriptor.js';
import type { LoopView } from '../../core/orchestrator/artifact-state.js';

import type {
  BedrockRequest,
  BedrockStructuredResponse,
  BedrockTransport,
} from './provider.js';

/**
 * Live Bedrock transport (Phase 3 / Step 31d, `decisions.md` D4). Invokes the
 * AWS Bedrock Converse API with structured tool-use; returns the raw
 * assistant tool-use payload UNTRUSTED — the loop validates it against
 * `aiProposalSchema` before any action (`agentic-loop.ts:90-101`).
 *
 * The AWS SDK is LAZILY imported inside `invokeModel` so a `--no-ai` scan and
 * the recorded-fixture test paths never load `@aws-sdk/client-bedrock-runtime`
 * (Step 31d V8). Credentials are resolved by the SDK's default provider chain
 * (env, `AWS_PROFILE`, SSO, web-identity, IMDS, ECS, process) — never read
 * here, never logged.
 */

export interface LiveBedrockTransportOptions {
  /** AWS region for the Bedrock client (env `AWS_REGION` / `AWS_DEFAULT_REGION`). */
  readonly region: string;
  /**
   * Override for the @aws-sdk/client-bedrock-runtime module loader (tests).
   * Production callers leave undefined → the lazy `await import(...)` runs.
   */
  readonly clientLoader?: () => Promise<{
    readonly BedrockRuntimeClient: new (config: { region: string }) => {
      readonly send: (cmd: unknown) => Promise<unknown>;
    };
    readonly ConverseCommand: new (input: unknown) => unknown;
  }>;
}

/**
 * Loose runtime view of the bits of `@aws-sdk/client-bedrock-runtime` we use.
 * We don't import the strict SDK types here so that:
 *  - the production import can be lazily resolved to `unknown` and then
 *    narrowed to this shape (no `any`);
 *  - test loaders can supply a tiny stub of the same shape without dragging
 *    the SDK typings into the test compile.
 */
interface LooseBedrockSdk {
  readonly BedrockRuntimeClient: new (config: { region: string }) => {
    readonly send: (cmd: unknown) => Promise<unknown>;
  };
  readonly ConverseCommand: new (input: unknown) => unknown;
}

/** Build a {@link BedrockTransport} that talks to live AWS Bedrock. */
export function liveBedrockTransport(
  opts: LiveBedrockTransportOptions,
): BedrockTransport {
  return {
    invokeModel: async (req: BedrockRequest) => {
      // Lazy import — keeps the SDK out of `--no-ai` and recorded-fixture
      // test paths (V8 enforces).
      const sdk = (opts.clientLoader !== undefined
        ? await opts.clientLoader()
        : await import('@aws-sdk/client-bedrock-runtime')) as unknown as LooseBedrockSdk;

      const { BedrockRuntimeClient, ConverseCommand } = sdk;
      const client = new BedrockRuntimeClient({ region: opts.region });

      const requestBody = buildConverseRequest(req);
      const cmd = new ConverseCommand(requestBody);
      const response = (await client.send(cmd)) as ConverseResponse;

      return mapConverseResponseToEnvelope(req.model_id, requestBody, response);
    },
  };
}

// ── Converse request shape (a subset of @aws-sdk/client-bedrock-runtime) ────

interface ConverseRequest {
  readonly modelId: string;
  readonly system: ReadonlyArray<{ readonly text: string }>;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: ReadonlyArray<{ readonly text: string }>;
  }>;
  readonly toolConfig: {
    readonly tools: ReadonlyArray<{
      readonly toolSpec: {
        readonly name: string;
        readonly description: string;
        readonly inputSchema: { readonly json: Record<string, unknown> };
      };
    }>;
  };
}

interface ConverseResponse {
  readonly output?: {
    readonly message?: {
      readonly content?: ReadonlyArray<
        | { readonly text?: string }
        | {
            readonly toolUse?: {
              readonly toolUseId?: string;
              readonly name?: string;
              readonly input?: unknown;
            };
          }
      >;
    };
  };
  readonly usage?: {
    readonly totalTokens?: number;
  };
}

function buildConverseRequest(req: BedrockRequest): ConverseRequest {
  return {
    modelId: req.model_id,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      {
        role: 'user',
        content: [{ text: renderViewForAi(req.view, req.descriptors) }],
      },
    ],
    toolConfig: {
      tools: [
        ...req.descriptors.map((d) => ({
          toolSpec: {
            name: String(d.tool_id),
            description: d.title,
            // Args are re-validated by the loop's `args_schema.safeParse`, so a
            // permissive object schema here is safe — the gate is downstream.
            inputSchema: { json: { type: 'object' } },
          },
        })),
        // Step 31d codex §6.5-r2 MUST #1: register `__done__` as an explicit
        // tool so the model has a structured way to signal termination.
        // Without it, a model that intends "done" via prose would emit no
        // toolUse and the response mapper had no way to distinguish "done"
        // from "the model gave up". The mapper now defaults to an invalid
        // proposal shape if no toolUse is found, so a missing __done__ call
        // becomes a typed reject (invalid_proposal), not a silent done.
        {
          toolSpec: {
            name: '__done__',
            description:
              'Signal that the required baseline is checked and the loop should terminate. Call this tool with an empty object {} when finished.',
            inputSchema: {
              json: {
                type: 'object',
                additionalProperties: false,
                properties: {},
              },
            },
          },
        },
      ],
    },
  };
}

const SYSTEM_PROMPT = [
  'You are Veyra’s agentic-loop driver.',
  'Propose ONE tool call per turn via structured tool-use; when the baseline is checked, propose the special tool `__done__` (the loop interprets that as a `done` proposal).',
  'Never emit a security verdict (no `finding_type`, `review_action`, `evidence_strength`, `blast_radius`, `reproducibility` fields). The deterministic floor classifies; you only collect facts.',
  'Use the allowed-claim vocabulary in any free-text: "checked", "found", "missing", "appears launch-blocking", "needs human review". Never "secure", "safe", "compliant".',
].join('\n\n');

function renderViewForAi(
  view: LoopView,
  descriptors: readonly ToolDescriptorView[],
): string {
  const parts: string[] = [];
  parts.push('## Registered tools');
  for (const d of descriptors) {
    parts.push(`- \`${String(d.tool_id)}\`: ${d.title}`);
  }
  parts.push('\n## Loop state so far');
  parts.push(JSON.stringify({ steps: view.steps, facts: view.facts }, null, 2));
  parts.push('\nPropose the next tool call (or `__done__` to finish).');
  return parts.join('\n');
}

function mapConverseResponseToEnvelope(
  modelId: string,
  request: ConverseRequest,
  response: ConverseResponse,
): BedrockStructuredResponse {
  const content = response.output?.message?.content ?? [];
  // Step 31d codex §6.5-r2 MUST #1: default to a shape that FAILS
  // `aiProposalSchema.safeParse`. A response with no toolUse block (e.g. the
  // model returned plain prose) becomes `invalid_proposal` in the loop — not
  // a silent `done`. The model has the explicit `__done__` tool registered
  // (see `buildConverseRequest`); intentional termination requires calling
  // it explicitly.
  let proposal: unknown = { kind: 'no_tool_use_in_response' };
  for (const item of content) {
    if ('toolUse' in item && item.toolUse !== undefined) {
      const name = item.toolUse.name ?? '';
      const args = item.toolUse.input ?? {};
      proposal =
        name === '__done__'
          ? { kind: 'done' }
          : { kind: 'invoke_tool', tool_id: name, args };
      break;
    }
  }
  // `prompt_fingerprint_sha256` is sha256 over the serialized REQUEST body —
  // the prompt context — not the response. Never the raw prompt text in any
  // artifact / trace.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(request))
    .digest('hex');
  const result: BedrockStructuredResponse = {
    proposal,
    prompt_fingerprint_sha256: fingerprint,
  };
  const totalTokens = response.usage?.totalTokens;
  if (typeof totalTokens === 'number' && totalTokens >= 0) {
    return { ...result, cost_units: totalTokens };
  }
  return result;
  // `model_id` is set by the loop driver wrapper, not here — every Bedrock-
  // path envelope MUST carry it (Step 31d V6); the provider does the merge.
}
