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
  | { readonly kind: 'available'; readonly envVarName: string }
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
      id: brandOrThrow('openai'),
      availability: {
        kind: 'deferred',
        deferredMessage:
          '--ai-provider openai: Phase 2 — not yet implemented (see phases/phase-2/PHASE_2_PLAN.md)',
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
