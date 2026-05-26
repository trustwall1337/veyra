/**
 * Step 2.03 unit tests for SandboxExecutor.
 *
 * Per codex plan-review P203-001/004: cover Mode A denied, Mode B
 * authorized-but-not-implemented, unknown action denied, and Mode C
 * denied. Per P203-002: defaultSandboxActiveValidationPolicy rejects
 * production. Per P203-003: ServiceRegistry registerExecutor +
 * lookupExecutor round-trip.
 */

import { describe, expect, it } from 'vitest';

import { asConnectorId } from '../../../../types/identity.js';
import {
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
  PolicyEnvironmentError,
} from '../../../../types/validation-policy.js';
import { ServiceRegistry } from '../../../registry/service-registry.js';

import { ExecutorPolicyViolationError, createSandboxExecutor } from './executor.js';
import { buildSupabaseHandlers, NotImplementedError } from './handlers/supabase.js';
import { registerSandboxExecutor, supabaseSandboxConnectorId } from './index.js';

function connectorId(s: string) {
  const r = asConnectorId(s);
  if (!r.ok) throw r.error;
  return r.value;
}

function fakeContext(policy: ReturnType<typeof defaultReadOnlyEvidencePolicy>) {
  return {
    scanId: 'test-scan',
    projectRoot: '/tmp/test',
    artifactDir: '/tmp/test/.veyra/scans/test-scan',
    policy,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function sandboxContextFor(env: 'local' | 'dev' | 'preview' | 'staging' | 'sandbox') {
  const policyR = defaultSandboxActiveValidationPolicy(env);
  if (!policyR.ok) throw policyR.error;
  return fakeContext(policyR.value);
}

describe('defaultSandboxActiveValidationPolicy (codex P203-002)', () => {
  it('rejects environment=production', () => {
    const r = defaultSandboxActiveValidationPolicy('production');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(PolicyEnvironmentError);
      expect(r.error.message).toContain('NOT be constructed');
      expect(r.error.message).toContain('FPP §17 Phase 5');
    }
  });

  it('accepts non-production environments', () => {
    for (const env of ['local', 'dev', 'preview', 'staging', 'sandbox'] as const) {
      const r = defaultSandboxActiveValidationPolicy(env);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.mode).toBe('sandbox_active_validation');
        expect(r.value.environment).toBe(env);
        expect(r.value.approval.required).toBe(true);
      }
    }
  });

  it('Mode B allowed_actions include read + the six synthetic actions; forbidden empty', () => {
    const r = defaultSandboxActiveValidationPolicy('dev');
    if (!r.ok) throw r.error;
    const a = r.value.allowed_actions;
    expect(a.has('read_code')).toBe(true);
    expect(a.has('read_schema_metadata')).toBe(true);
    expect(a.has('create_synthetic_user')).toBe(true);
    expect(a.has('verify_denial')).toBe(true);
    expect(a.has('cleanup_veyra_created_data')).toBe(true);
    expect(r.value.forbidden_actions.size).toBe(0);
  });

  it('Mode A still has the synthetic six in forbidden_actions (no asymmetry regression)', () => {
    const a = defaultReadOnlyEvidencePolicy('local');
    expect(a.forbidden_actions.has('create_synthetic_user')).toBe(true);
    expect(a.forbidden_actions.has('verify_denial')).toBe(true);
    expect(a.allowed_actions.has('create_synthetic_user')).toBe(false);
  });
});

describe('SandboxExecutor allow/deny (codex P203-001 + P203-004)', () => {
  it('Mode B authorized action returns NotImplementedError (stub) per P203-004', async () => {
    const id = supabaseSandboxConnectorId;
    const executor = createSandboxExecutor({
      id,
      handlers: buildSupabaseHandlers({ executorId: id }),
    });
    const ctx = sandboxContextFor('sandbox');
    const r = await executor.execute('create_synthetic_user', { role: 'authenticated' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(NotImplementedError);
      expect(r.error.message).toContain('not implemented yet');
      expect(r.error.message).toContain('step 2.06');
    }
  });

  it('Mode A denies a synthetic action with ExecutorPolicyViolationError BEFORE the handler', async () => {
    const id = supabaseSandboxConnectorId;
    const executor = createSandboxExecutor({
      id,
      handlers: buildSupabaseHandlers({ executorId: id }),
    });
    const ctx = fakeContext(defaultReadOnlyEvidencePolicy('local'));
    const r = await executor.execute('create_synthetic_user', {}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ExecutorPolicyViolationError);
      // P203-001: refusal must reference policy.allowed_actions, NOT mode-string.
      expect(r.error.message).toContain('allowed_actions');
    }
  });

  it('unknown action denied (cast to AllowedAction in test simulates a future variant)', async () => {
    const id = supabaseSandboxConnectorId;
    const executor = createSandboxExecutor({
      id,
      handlers: {} as never,
    });
    const ctx = sandboxContextFor('sandbox');
    const r = await executor.execute('create_synthetic_user', {}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ExecutorPolicyViolationError);
      expect(r.error.message).toContain('no handler bound');
    }
  });

  it('supportsMode is true only for sandbox_active_validation', () => {
    const id = supabaseSandboxConnectorId;
    const executor = createSandboxExecutor({
      id,
      handlers: buildSupabaseHandlers({ executorId: id }),
    });
    expect(executor.supportsMode('sandbox_active_validation')).toBe(true);
    expect(executor.supportsMode('read_only_evidence')).toBe(false);
    expect(executor.supportsMode('approved_production_safe')).toBe(false);
  });

  it('executor does NOT read policy.mode in its allow-check (only allowed_actions)', async () => {
    // Construct a synthetic policy with mode='read_only_evidence' but
    // allowed_actions containing create_synthetic_user. The executor
    // must allow the call (mode is metadata, not authority).
    const id = supabaseSandboxConnectorId;
    const executor = createSandboxExecutor({
      id,
      handlers: buildSupabaseHandlers({ executorId: id }),
    });
    const synthetic = {
      ...defaultReadOnlyEvidencePolicy('local'),
      allowed_actions: new Set([
        'read_code',
        'create_synthetic_user',
      ] as const) as ReadonlySet<import('../../../../types/validation-policy.js').AllowedAction>,
      forbidden_actions: new Set<
        import('../../../../types/validation-policy.js').AllowedAction
      >(),
    };
    const ctx = fakeContext(synthetic);
    const r = await executor.execute('create_synthetic_user', {}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // It should reach the handler (NotImplementedError), NOT short-circuit
      // on the wrong mode. This is the P203-001 anti-drift assertion.
      expect(r.error).toBeInstanceOf(NotImplementedError);
    }
  });
});

describe('SandboxExecutor registry registration (codex P203-003)', () => {
  it('registerSandboxExecutor inserts a descriptor under the connector id', () => {
    const reg = new ServiceRegistry();
    const r = registerSandboxExecutor(reg);
    expect(r.ok).toBe(true);
    const looked = reg.lookupExecutor(supabaseSandboxConnectorId);
    expect(looked.ok).toBe(true);
    if (looked.ok) {
      expect(looked.value.id).toBe(supabaseSandboxConnectorId);
      expect(looked.value.executor.supportsMode('sandbox_active_validation')).toBe(true);
    }
  });

  it('double-register fires the collision RegistryError', () => {
    const reg = new ServiceRegistry();
    expect(registerSandboxExecutor(reg).ok).toBe(true);
    const second = registerSandboxExecutor(reg);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toContain('collision');
  });

  it('listExecutors returns the registered descriptors', () => {
    const reg = new ServiceRegistry();
    registerSandboxExecutor(reg);
    const list = reg.listExecutors();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(supabaseSandboxConnectorId);
  });

  it('unknown executor id returns RegistryError', () => {
    const reg = new ServiceRegistry();
    const r = reg.lookupExecutor(connectorId('never-registered'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('Unknown executor id');
  });
});
