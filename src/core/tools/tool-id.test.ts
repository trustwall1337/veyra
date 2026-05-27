import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../../types/result.js';

import { asToolId } from './tool-id.js';

describe('asToolId', () => {
  it('accepts lower-kebab ids', () => {
    for (const id of ['run-gitleaks', 'read-schema', 'read-code', 'x9']) {
      const r = asToolId(id);
      expect(isOk(r)).toBe(true);
    }
  });

  it('rejects empty, uppercase, and malformed ids', () => {
    for (const bad of ['', 'RunGitleaks', 'read_schema', '-leading', 'trailing-', 'a']) {
      const r = asToolId(bad);
      expect(isErr(r)).toBe(true);
    }
  });

  it('returns the branded value on success', () => {
    const r = asToolId('run-osv');
    if (isErr(r)) throw new Error('expected ok');
    expect(r.value).toBe('run-osv');
  });
});
