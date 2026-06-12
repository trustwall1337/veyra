/**
 * Provider registry.
 *
 * Per AI-shape revision §12b and FPP §2A: `--ai-provider` accepts any
 * **registered** provider id. The CLI does not carry a closed
 * `'anthropic' | 'openai'` string union — instead it asks this registry
 * to resolve an id at runtime. Adding a new provider (Bedrock,
 * local-llm, etc.) is a single row here; no shared-type edits.
 *
 * The registry also encodes Phase 1 enablement: `anthropic` is
 * `available` and reads `ANTHROPIC_API_KEY`; `openai` is `deferred` and
 * rejects at parse-time with an explicit "not yet implemented" message
 * pointing at the Phase 2 plan (per the revision's deferred-mode
 * rejection rule).
 */

import { asProviderId, type ProviderId } from '../types/identity.js';

export type ProviderAvailability =
  | {
      readonly kind: 'available';
      readonly envVarName: string;
      /**
       * Additional env vars whose presence is ALSO required for opt-in.
       * codex p3-r2-002: provided for any future static-env provider that
       * needs multi-var checks. Bedrock used this in step 31b but step 31d
       * moved Bedrock to the `available_via_sdk_chain` variant below so
       * `AWS_PROFILE`-only environments are accepted. Each entry is
       * `string` (single var, required) or a `readonly string[]` (any-of
       * group — the CLI accepts if at least one is set).
       */
      readonly requiresAdditionalEnv?: ReadonlyArray<string | readonly string[]>;
    }
  | {
      /**
       * Step 31d: presence is verified by an SDK provider chain at runtime
       * (env, `AWS_PROFILE`, SSO, web-identity, IMDS, ECS, process). The
       * CLI registry layer only confirms the env vars the SDK consults are
       * at least *possible* — the actual identity resolution happens in
       * `src/ai/bedrock/auth.ts:readAwsCredentials()` via a lazy import of
       * `@aws-sdk/credential-providers`.
       */
      readonly kind: 'available_via_sdk_chain';
      /**
       * Each group is an "any-of" set of env var names; at least one in
       * each group must be set for the CLI to admit the run. Bedrock uses
       * `[['AWS_REGION', 'AWS_DEFAULT_REGION']]` — region must be set
       * somewhere; static keys are no longer hard requirements at the
       * registry layer.
       */
      readonly requiredAnyOfEnv: ReadonlyArray<readonly string[]>;
    }
  | { readonly kind: 'deferred'; readonly deferredMessage: string };

export interface ProviderEntry {
  readonly id: ProviderId;
  readonly availability: ProviderAvailability;
}

export interface ProviderRegistry {
  list(): readonly ProviderEntry[];
  resolve(id: string): ProviderEntry | undefined;
}

function brandOrThrow(value: string): ProviderId {
  const r = asProviderId(value);
  if (!r.ok) {
    throw new Error(
      `bug: hardcoded provider id "${value}" invalid: ${r.error.message}`,
    );
  }
  return r.value;
}

/**
 * Phase 1 registration table. Adding a provider = adding a row.
 * Removing one = removing a row. The CLI never names these ids;
 * `resolve` is the only entry point that consumers should rely on.
 */
function buildDefaultProviderEntries(): readonly ProviderEntry[] {
  return [
    {
      id: brandOrThrow('anthropic'),
      availability: {
        kind: 'available',
        envVarName: 'ANTHROPIC_API_KEY',
      },
    },
    {
      // Step 2.04: OpenAI flipped from deferred to available. The
      // adapter lives at `src/ai/openai.ts`; OPENAI_API_KEY is the
      // env var name customers set to opt in.
      id: brandOrThrow('openai'),
      availability: {
        kind: 'available',
        envVarName: 'OPENAI_API_KEY',
      },
    },
    {
      // Step 31d / decisions.md D4: Bedrock auth is resolved at RUNTIME by
      // the AWS SDK default provider chain (env, `AWS_PROFILE`, SSO, web
      // identity, IMDS, ECS, process). The registry layer only confirms
      // region is set somewhere (the only env var that's safe to require
      // at the CLI boundary — region is non-secret); the SDK probe in
      // `auth.ts` is the authority for "does a credential exist". This
      // closes the previous `AWS_PROFILE`-only blocker (the registry used
      // to demand the static AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY).
      id: brandOrThrow('bedrock'),
      availability: {
        kind: 'available_via_sdk_chain',
        requiredAnyOfEnv: [['AWS_REGION', 'AWS_DEFAULT_REGION']],
      },
    },
  ];
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  const entries = buildDefaultProviderEntries();
  const byId = new Map<string, ProviderEntry>(
    entries.map((e) => [e.id as string, e]),
  );
  return {
    list: () => entries,
    resolve: (id) => byId.get(id),
  };
}
