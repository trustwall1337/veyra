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
       * codex p3-r2-002: Bedrock needs the full AWS triple
       * (`AWS_SECRET_ACCESS_KEY` + `AWS_REGION`/`AWS_DEFAULT_REGION`), not
       * just `AWS_ACCESS_KEY_ID`. Each entry is `string` (single var) or a
       * `readonly string[]` (any-of group — the CLI accepts if at least one
       * is set).
       */
      readonly requiresAdditionalEnv?: ReadonlyArray<string | readonly string[]>;
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
      // codex p3-r1-010 / p3-r2-002 / decisions.md D4: Bedrock is the Phase-3
      // default loop driver. Auth is env-only; the full triple is required.
      // The live SDK transport is wired in a follow-up; `auth.ts` does the
      // hard check at runtime.
      id: brandOrThrow('bedrock'),
      availability: {
        kind: 'available',
        envVarName: 'AWS_ACCESS_KEY_ID',
        requiresAdditionalEnv: [
          'AWS_SECRET_ACCESS_KEY',
          ['AWS_REGION', 'AWS_DEFAULT_REGION'],
        ],
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
