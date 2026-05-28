import type {
  AiDriver,
  AiProposalEnvelope,
} from '../../core/orchestrator/agentic-loop.js';
import type { LoopView } from '../../core/orchestrator/artifact-state.js';
import { type ProviderId, asProviderId } from '../../types/identity.js';
import { isErr } from '../../types/result.js';
import type { ToolDescriptorView } from '../../core/tools/descriptor.js';

/**
 * Bedrock provider adapter (Phase 3 / Step 31b, D4). One folder, one opaque
 * `ProviderId`, no closed provider union (FPP §2A). The Bedrock client is
 * dependency-injected as a {@link BedrockTransport} so tests use a
 * recorded-response fixture without depending on the real `@aws-sdk` package
 * or live network access. Live transports talk to Bedrock Converse / InvokeModel
 * with SigV4 auth picked up from the environment via the AWS SDK.
 *
 * Trust model: the loop-trace records `model_id` (the Bedrock model id —
 * audit metadata, not a credential). AWS credentials never appear in argv,
 * an artifact, or a trace.
 */

/** The opaque id under which the Bedrock provider registers. */
export const BEDROCK_PROVIDER_ID: ProviderId = (() => {
  const r = asProviderId('bedrock');
  if (!r.ok) throw new Error('invalid built-in provider id');
  return r.value;
})();

export interface BedrockRequest {
  readonly model_id: string;
  /** Redacted view the AI sees this step. */
  readonly view: LoopView;
  /** Descriptors of tools currently in scope. */
  readonly descriptors: readonly ToolDescriptorView[];
}

export interface BedrockStructuredResponse {
  /** Raw proposal (validated by the loop against `aiProposalSchema`). */
  readonly proposal: unknown;
  /** Token-equivalent cost of this call. */
  readonly cost_units?: number;
  /** Prompt fingerprint (sha256), for the loop-trace audit. */
  readonly prompt_fingerprint_sha256?: string;
}

export interface BedrockTransport {
  invokeModel(req: BedrockRequest): Promise<BedrockStructuredResponse>;
}

export interface BedrockProviderOptions {
  readonly transport: BedrockTransport;
  /** The Bedrock model id (e.g. `anthropic.claude-3-5-sonnet-20240620-v1:0`). */
  readonly modelId: string;
}

/**
 * Build the Bedrock {@link AiDriver} the agentic loop calls. The driver maps
 * each `proposeNext` to one Bedrock invocation, threads `model_id` and
 * `prompt_fingerprint_sha256` into the envelope for the loop-trace, and
 * passes the structured output through unchanged for the loop's typed-union
 * validation step.
 */
export function createBedrockProvider(
  options: BedrockProviderOptions,
): { id: ProviderId; driver: AiDriver } {
  return {
    id: BEDROCK_PROVIDER_ID,
    driver: {
      proposeNext: async (
        view: LoopView,
        descriptors: readonly ToolDescriptorView[],
      ): Promise<AiProposalEnvelope> => {
        const response = await options.transport.invokeModel({
          model_id: options.modelId,
          view,
          descriptors,
        });
        // Build the envelope. `model_id` is the Bedrock model — audit metadata,
        // not a credential. The proposal itself is untrusted; the loop will
        // validate it against `aiProposalSchema` before use.
        const envelope: AiProposalEnvelope = {
          proposal: response.proposal,
          model_id: options.modelId,
          ...(response.cost_units !== undefined
            ? { cost_units: response.cost_units }
            : {}),
          ...(response.prompt_fingerprint_sha256 !== undefined
            ? { prompt_fingerprint_sha256: response.prompt_fingerprint_sha256 }
            : {}),
        };
        return envelope;
      },
    },
  };
}

/**
 * Recorded-fixture transport: replays a pre-captured Bedrock response. Used
 * by tests so the suite is deterministic without live network or AWS creds.
 * `recordings` is a queue; each call shifts one off.
 */
export function recordedBedrockTransport(
  recordings: readonly BedrockStructuredResponse[],
): BedrockTransport {
  const queue = [...recordings];
  return {
    invokeModel: async () => {
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('bedrock recording exhausted');
      }
      return next;
    },
  };
}

/**
 * Live transport stub: throws unless the caller wires the real AWS SDK. We
 * intentionally do NOT import `@aws-sdk/client-bedrock-runtime` from this
 * file — the import would broaden the dependency surface and require live
 * creds for tests. A future step adds the SDK wiring; for now the live path
 * is a no-op skipped by env-gated tests (Phase 2 step 01 preventer 7).
 */
export function liveBedrockTransport(): BedrockTransport {
  return {
    invokeModel: async () => {
      const credsErr = isErr(
        (await import('./auth.js')).readAwsCredentials(),
      );
      throw new Error(
        credsErr
          ? 'live Bedrock transport requires AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION in env'
          : 'live Bedrock transport not wired in this build — recorded-fixture transport must be used',
      );
    },
  };
}
