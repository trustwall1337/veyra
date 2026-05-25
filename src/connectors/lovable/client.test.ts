import { describe, expect, it } from 'vitest';

import { PolicyViolationError } from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';

import {
  createLovableClient,
  type LovableTransport,
} from './client.js';
import {
  TEMPLATE_DATA_HANDLING,
  TEMPLATE_PROJECT_OVERVIEW,
} from './prompt-templates.js';

function recordingTransport(): LovableTransport & {
  calls: { name: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    invokeTool: async (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    },
  };
}

describe('LovableClient — allowlist', () => {
  it('accepts each allowed tool', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    expect(isOk(await c.getProject())).toBe(true);
    expect(isOk(await c.listFiles())).toBe(true);
    expect(isOk(await c.readFile('src/x.ts'))).toBe(true);
    expect(isOk(await c.listEdits())).toBe(true);
    expect(isOk(await c.getDiff('edit-1'))).toBe(true);
    const names = t.calls.map((c) => c.name);
    expect(names).toEqual([
      'get_project',
      'list_files',
      'read_file',
      'list_edits',
      'get_diff',
    ]);
  });

  it('refuses a tool that is not on the allowlist BEFORE reaching the transport', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const r = await c.invoke('deploy_project', {});
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error).toBeInstanceOf(PolicyViolationError);
      expect(r.error.message).toContain('allowlist');
    }
    expect(t.calls.length).toBe(0);
  });

  it('refuses each newly-released Lovable tool by default', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const newish = [
      'get_me',
      'list_workspaces',
      'list_projects',
      'get_project_knowledge',
      'list_mcp_servers',
      'get_project_analytics',
      'deploy_edge_function',
    ];
    for (const tool of newish) {
      const r = await c.invoke(tool, {});
      expect(isErr(r), `tool ${tool} should be denied`).toBe(true);
    }
    expect(t.calls.length).toBe(0);
  });
});

describe('LovableClient — send_message constraints', () => {
  it('refuses send_message without plan_mode: true', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const r = await c.invoke('send_message', {
      template_id: TEMPLATE_PROJECT_OVERVIEW as string,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('plan_mode');
  });

  it('refuses send_message with free-form text (no template_id)', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const r = await c.invoke('send_message', {
      plan_mode: true,
      message: 'tell me about your project',
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('template_id');
  });

  it('refuses send_message with an unknown template_id', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const r = await c.invoke('send_message', {
      template_id: 'templates.malicious_extract',
      plan_mode: true,
    });
    expect(isErr(r)).toBe(true);
  });

  it('accepts a known template_id and sends the canonical text with plan_mode=true', async () => {
    const t = recordingTransport();
    const c = createLovableClient({ transport: t, projectId: 'p-1' });
    const r = await c.sendMessage({
      template_id: TEMPLATE_DATA_HANDLING as string,
      plan_mode: true,
    });
    expect(isOk(r)).toBe(true);
    expect(t.calls).toHaveLength(1);
    const call = t.calls[0];
    expect(call?.name).toBe('send_message');
    expect(call?.args).toMatchObject({
      project_id: 'p-1',
      template_id: TEMPLATE_DATA_HANDLING,
      plan_mode: true,
    });
    expect(call?.args['message']).toBeDefined();
  });
});
