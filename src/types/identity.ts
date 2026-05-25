import { type Result, err, ok } from './result.js';

export type ConnectorId = string & { readonly __brand: 'ConnectorId' };
export type ScannerId = string & { readonly __brand: 'ScannerId' };
export type AnalyzerId = string & { readonly __brand: 'AnalyzerId' };
export type DatabaseId = string & { readonly __brand: 'DatabaseId' };
export type TransportId = string & { readonly __brand: 'TransportId' };
/**
 * Opaque identifier for a deterministic parser. Added in step 02b for
 * `ScanFact.source.kind = 'schema_element'` per the AI-shape revision §3.1.
 * Future parsers (e.g. Firestore rules, GraphQL schema, OpenAPI) register
 * a new ParserId without shared-type edits.
 */
export type ParserId = string & { readonly __brand: 'ParserId' };
/**
 * Opaque identifier for an AI provider adapter. Added in step 02c for
 * `AiProvider.id` per the AI-shape revision §7.2. New providers (OpenAI,
 * Bedrock, local-llm, etc.) register a new ProviderId — no shared-type
 * edits, no closed `'anthropic' | 'openai'` union anywhere.
 */
export type ProviderId = string & { readonly __brand: 'ProviderId' };

export class InvalidIdError extends Error {
  override readonly name = 'InvalidIdError';
}

const ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

function makeId<T extends string>(
  brand: string,
  value: string,
): Result<T, InvalidIdError> {
  if (value.length === 0) {
    return err(new InvalidIdError(`${brand} cannot be empty`));
  }
  if (!ID_PATTERN.test(value)) {
    return err(
      new InvalidIdError(
        `${brand} must match ${ID_PATTERN.source}: got "${value}"`,
      ),
    );
  }
  return ok(value as T);
}

export const asConnectorId = (s: string): Result<ConnectorId, InvalidIdError> =>
  makeId<ConnectorId>('ConnectorId', s);

export const asScannerId = (s: string): Result<ScannerId, InvalidIdError> =>
  makeId<ScannerId>('ScannerId', s);

export const asAnalyzerId = (s: string): Result<AnalyzerId, InvalidIdError> =>
  makeId<AnalyzerId>('AnalyzerId', s);

export const asDatabaseId = (s: string): Result<DatabaseId, InvalidIdError> =>
  makeId<DatabaseId>('DatabaseId', s);

export const asTransportId = (s: string): Result<TransportId, InvalidIdError> =>
  makeId<TransportId>('TransportId', s);

export const asParserId = (s: string): Result<ParserId, InvalidIdError> =>
  makeId<ParserId>('ParserId', s);

export const asProviderId = (s: string): Result<ProviderId, InvalidIdError> =>
  makeId<ProviderId>('ProviderId', s);
