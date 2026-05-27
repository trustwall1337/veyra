import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import { isErr, ok } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';

import type { ToolDescriptor } from './descriptor.js';
import { DuplicateToolIdError, createToolRegistry } from './registry.js';
import { asToolId } from './tool-id.js';

const resultSchema = toolResultBaseSchema as unknown as ZodType<ToolResult>;

function makeDescriptor(idStr: string): ToolDescriptor<{ q: string }, ToolResult> {
  const id = asToolId(idStr);
  if (isErr(id)) throw new Error(`bad test id: ${idStr}`);
  return {
    tool_id: id.value,
    title: `Test tool ${idStr}`,
    args_schema: z.object({ q: z.string() }),
    result_schema: resultSchema,
    required_action: 'read_code',
    source_module: 'src/core/tools/registry.test.ts',
    invoke: async () => ok({ facts: [] }),
  };
}

function toolId(idStr: string) {
  const id = asToolId(idStr);
  if (isErr(id)) throw new Error(`bad test id: ${idStr}`);
  return id.value;
}

describe('tool registry', () => {
  it('resolves a registered tool to its full descriptor', () => {
    const reg = createToolRegistry();
    reg.register(makeDescriptor('run-gitleaks'));
    const full = reg.resolve(toolId('run-gitleaks'));
    expect(full).toBeDefined();
    expect(typeof full?.invoke).toBe('function');
    expect(full?.source_module).toBe('src/core/tools/registry.test.ts');
    expect(full?.required_action).toBe('read_code');
  });

  it('returns undefined for an unregistered id', () => {
    const reg = createToolRegistry();
    expect(reg.resolve(toolId('never-registered'))).toBeUndefined();
  });

  it('throws DuplicateToolIdError on a repeat id', () => {
    const reg = createToolRegistry();
    reg.register(makeDescriptor('run-osv'));
    expect(() => reg.register(makeDescriptor('run-osv'))).toThrow(
      DuplicateToolIdError,
    );
  });

  it('descriptors() exposes only id + title + args_schema, never invoke', () => {
    const reg = createToolRegistry();
    reg.register(makeDescriptor('read-schema'));
    const views = reg.descriptors();
    expect(views).toHaveLength(1);
    const view = views[0];
    if (view === undefined) throw new Error('expected one descriptor view');

    expect(view.tool_id).toBe('read-schema');
    expect(view.title).toContain('read-schema');
    expect(typeof view.args_schema.safeParse).toBe('function');

    // The AI-facing view must never carry the runnable function or
    // runtime-only fields (PLAN §B descriptor boundary).
    expect('invoke' in view).toBe(false);
    expect('result_schema' in view).toBe(false);
    expect('source_module' in view).toBe(false);
    expect('required_action' in view).toBe(false);
  });

  it('counts registered tools', () => {
    const reg = createToolRegistry();
    expect(reg.size()).toBe(0);
    reg.register(makeDescriptor('run-gitleaks'));
    reg.register(makeDescriptor('run-osv'));
    expect(reg.size()).toBe(2);
    expect(reg.has(toolId('run-gitleaks'))).toBe(true);
    expect(reg.has(toolId('run-semgrep'))).toBe(false);
  });
});
