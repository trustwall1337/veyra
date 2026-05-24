import { type Result, err, ok } from './result.js';

export type ConnectorId = string & { readonly __brand: 'ConnectorId' };
export type ScannerId = string & { readonly __brand: 'ScannerId' };
export type AnalyzerId = string & { readonly __brand: 'AnalyzerId' };
export type DatabaseId = string & { readonly __brand: 'DatabaseId' };
export type TransportId = string & { readonly __brand: 'TransportId' };

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
