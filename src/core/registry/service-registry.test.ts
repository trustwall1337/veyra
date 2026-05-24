import { beforeEach, describe, expect, it } from 'vitest';

import { asConnectorId } from '../../types/identity.js';
import { isErr, isOk } from '../../types/result.js';

import { ServiceRegistry } from './service-registry.js';

describe('service-registry', () => {
  let r: ServiceRegistry;
  beforeEach(() => {
    r = new ServiceRegistry();
  });

  it('rejects duplicate connector registration (collision)', () => {
    const id = asConnectorId('test-connector');
    if (isErr(id)) throw new Error('id construction failed');

    const first = r.registerConnector({ id: id.value, displayName: 'first' });
    expect(isOk(first)).toBe(true);

    const second = r.registerConnector({
      id: id.value,
      displayName: 'second',
    });
    expect(isErr(second)).toBe(true);
  });

  it('rejects lookup of an unregistered connector', () => {
    const id = asConnectorId('not-registered');
    if (isErr(id)) throw new Error('id construction failed');

    const result = r.lookupConnector(id.value);
    expect(isErr(result)).toBe(true);
  });

  it('returns the registered descriptor on lookup', () => {
    const id = asConnectorId('present-connector');
    if (isErr(id)) throw new Error('id construction failed');
    r.registerConnector({ id: id.value, displayName: 'present' });

    const result = r.lookupConnector(id.value);
    if (isErr(result)) throw new Error('expected ok');
    expect(result.value.displayName).toBe('present');
  });
});
