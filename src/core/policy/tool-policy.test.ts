import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../../types/result.js';
import {
  type ValidationPolicy,
  defaultReadOnlyEvidencePolicy,
} from '../../types/validation-policy.js';

import { enforce } from './tool-policy.js';

const policy = defaultReadOnlyEvidencePolicy('local');

describe('tool-policy enforce', () => {
  it('(a) denies create_synthetic_user under default read_only_evidence policy', () => {
    const result = enforce(
      {
        serviceId: 'supabase',
        tool: 'create_user',
        action: 'create_synthetic_user',
      },
      policy,
    );
    expect(isErr(result)).toBe(true);
  });

  it('(b) returns PolicyViolationError for an action not in the allowed set', () => {
    const result = enforce(
      {
        serviceId: 'lovable',
        tool: 'send_message',
        action: 'verify_denial',
      },
      policy,
    );
    if (isOk(result)) throw new Error('expected error');
    expect(result.error.name).toBe('PolicyViolationError');
  });

  it('(c) returns ok for an allowlisted action', () => {
    const result = enforce(
      {
        serviceId: 'lovable',
        tool: 'read_file',
        action: 'read_code',
      },
      policy,
    );
    expect(isOk(result)).toBe(true);
  });

  it('(d) decisions consult allowed_actions, not mode', () => {
    // Mode says read_only_evidence (which normally allows read_code) but
    // allowed_actions is empty. enforce MUST follow the set, not the mode.
    const inconsistentPolicy: ValidationPolicy = {
      mode: 'read_only_evidence',
      environment: 'local',
      allowed_actions: new Set(),
      forbidden_actions: new Set(),
      approval: { required: false },
    };
    const result = enforce(
      {
        serviceId: 'lovable',
        tool: 'read_file',
        action: 'read_code',
      },
      inconsistentPolicy,
    );
    expect(isErr(result)).toBe(true);
  });
});
