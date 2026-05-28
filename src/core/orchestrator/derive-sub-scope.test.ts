import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ok, isErr, isOk } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';
import {
  type AllowedAction,
  defaultReadOnlyEvidencePolicy,
} from '../../types/validation-policy.js';
import { targetDescriptorSchema } from '../tools/deep-dive.js';
import { ToolInvocationError, type ToolDescriptor } from '../tools/descriptor.js';
import { createToolRegistry } from '../tools/registry.js';
import { asToolId } from '../tools/tool-id.js';

import { deriveSubScope } from './derive-sub-scope.js';

const RESULT_SCHEMA = toolResultBaseSchema as unknown as ZodType<ToolResult>;
const READ_ONLY = defaultReadOnlyEvidencePolicy('dev');

function tid(id: string) {
  const r = asToolId(id);
  if (!r.ok) throw new Error(`bad id ${id}`);
  return r.value;
}

function tool(id: string, action: AllowedAction): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid(id),
    title: id,
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: action,
    source_module: 'derive-sub-scope.test.ts',
    invoke: async () => ok({ facts: [] } as ToolResult),
  };
}

const rlsTarget = targetDescriptorSchema.parse({
  kind: 'rls_policy_graph',
  subject: 'fact:table-users',
});

describe('deriveSubScope — strict subset (Verification b)', () => {
  it('returns a non-empty strict subset of the parent scope', () => {
    const reg = createToolRegistry();
    reg.register(tool('schema-meta', 'read_schema_metadata')); // in scope
    reg.register(tool('storage-meta', 'read_storage_metadata')); // in scope
    reg.register(tool('read-code', 'read_code')); // out of scope (keeps parent > sub)
    const parentScope = new Set([
      tid('schema-meta'),
      tid('storage-meta'),
      tid('read-code'),
    ]);

    const r = deriveSubScope({
      target: rlsTarget,
      parentScope,
      registry: reg,
      policy: READ_ONLY,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.size).toBe(2);
    expect(r.value.size).toBeLessThan(parentScope.size);
    // Every member is a parent-scope member (filtered FROM parentScope).
    for (const id of r.value) expect(parentScope.has(id)).toBe(true);
    // Every member's required_action is in the policy's allowed_actions.
    for (const id of r.value) {
      const d = reg.resolve(id);
      expect(d).toBeDefined();
      expect(READ_ONLY.allowed_actions.has(d!.required_action)).toBe(true);
    }
  });

  it('errors on an empty derived sub-scope', () => {
    const reg = createToolRegistry();
    reg.register(tool('read-code', 'read_code')); // not in rls scope
    const parentScope = new Set([tid('read-code')]);
    const r = deriveSubScope({
      target: rlsTarget,
      parentScope,
      registry: reg,
      policy: READ_ONLY,
    });
    expect(isErr(r)).toBe(true);
  });

  it('errors on a non-proper-subset (sub.size === parent.size)', () => {
    const reg = createToolRegistry();
    reg.register(tool('schema-meta', 'read_schema_metadata'));
    const parentScope = new Set([tid('schema-meta')]);
    // Without an out-of-scope tool, sub == parent → not strict.
    const r = deriveSubScope({
      target: rlsTarget,
      parentScope,
      registry: reg,
      policy: READ_ONLY,
    });
    expect(isErr(r)).toBe(true);
  });
});

describe('deriveSubScope — Mode A write-free (Verification c)', () => {
  it('the read-only-mode sub-scope contains no mutation/probe tool', () => {
    const reg = createToolRegistry();
    reg.register(tool('schema-meta', 'read_schema_metadata'));
    reg.register(tool('read-code', 'read_code'));
    // A write-probe tool registered does NOT enter the sub-scope under read-only
    // (its required_action is not in the policy's allowed_actions, and not in
    // the table for rls_policy_graph).
    reg.register(tool('probe', 'call_api_with_test_identity'));
    const parentScope = new Set([
      tid('schema-meta'),
      tid('read-code'),
      tid('probe'),
    ]);
    const r = deriveSubScope({
      target: rlsTarget,
      parentScope,
      registry: reg,
      policy: READ_ONLY,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    for (const id of r.value) {
      const d = reg.resolve(id);
      expect(d?.required_action).not.toBe('call_api_with_test_identity');
      expect(d?.required_action).not.toBe('verify_denial');
      expect(d?.required_action).not.toBe('create_synthetic_user');
    }
  });
});

describe('deriveSubScope — no tool promotion (Verification d)', () => {
  it('a tool absent from parentScope is never in the result', () => {
    const reg = createToolRegistry();
    reg.register(tool('schema-meta', 'read_schema_metadata'));
    reg.register(tool('hidden', 'read_schema_metadata')); // in registry but NOT in parent scope
    reg.register(tool('read-code', 'read_code'));
    const parentScope = new Set([tid('schema-meta'), tid('read-code')]); // 'hidden' deliberately absent
    const r = deriveSubScope({
      target: rlsTarget,
      parentScope,
      registry: reg,
      policy: READ_ONLY,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.has(tid('hidden'))).toBe(false); // never promoted
    expect(r.value.has(tid('schema-meta'))).toBe(true);
  });
});

// `ToolInvocationError` is referenced for typecheck via the descriptor's Result
// generic; this line keeps the import non-unused without a test.
void ToolInvocationError;
