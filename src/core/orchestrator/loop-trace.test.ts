import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ok } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';
import type { ToolContext, ToolDescriptor } from '../tools/descriptor.js';
import { createToolRegistry } from '../tools/registry.js';
import { asToolId } from '../tools/tool-id.js';

import {
  type AiDriver,
  type LoopView,
  runAgenticLoop,
} from './agentic-loop.js';

const RESULT_SCHEMA = toolResultBaseSchema as unknown as ZodType<ToolResult>;
const POLICY = defaultReadOnlyEvidencePolicy('dev');
const CONTEXT: ToolContext = { scanId: 's1', projectPath: '/tmp/p' };

const RAW_EMAIL = 'admin@example.com';

function tid(id: string) {
  const r = asToolId(id);
  if (!r.ok) throw new Error(`bad id ${id}`);
  return r.value;
}

function emailEmittingTool(): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid('email-tool'),
    title: 'returns a fact carrying an email',
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: 'read_code',
    source_module: 'loop-trace.test.ts',
    invoke: async () =>
      ok({ facts: [{ name: 'contact', value: RAW_EMAIL }] } as ToolResult),
  };
}

function capturingDriver(): {
  driver: AiDriver;
  views: LoopView[];
} {
  const views: LoopView[] = [];
  const proposals: unknown[] = [
    { kind: 'invoke_tool', tool_id: 'email-tool', args: {} },
    { kind: 'done' },
  ];
  let i = 0;
  return {
    views,
    driver: {
      proposeNext: async (view) => {
        views.push(view);
        const proposal = proposals[i] ?? { kind: 'done' };
        i += 1;
        return {
          proposal,
          model_id: 'test-model',
          prompt_fingerprint_sha256: 'fp-deadbeef',
        };
      },
    },
  };
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-trace-'));
}

describe('agentic loop — loop-view redaction (Step 34 Verification a)', () => {
  it('the view the AI sees has the email replaced with REDACTED_EMAIL_1', async () => {
    const reg = createToolRegistry();
    reg.register(emailEmittingTool());
    const { driver, views } = capturingDriver();
    const artifactDir = await tmpDir();

    await runAgenticLoop({
      registry: reg,
      aiDriver: driver,
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });

    // The view passed to the SECOND propose (after the tool returned) carries
    // the accepted fact — redacted.
    const second = views.at(1);
    expect(second).toBeDefined();
    const sawAlias = JSON.stringify(second).includes('REDACTED_EMAIL_1');
    const sawRaw = JSON.stringify(second).includes(RAW_EMAIL);
    expect(sawAlias).toBe(true);
    expect(sawRaw).toBe(false);
  });
});

describe('agentic loop — loop-trace.jsonl (Step 34 Verification b/c/d)', () => {
  it('writes one row per state record, each carrying the §F fields', async () => {
    const reg = createToolRegistry();
    reg.register(emailEmittingTool());
    const { driver } = capturingDriver();
    const artifactDir = await tmpDir();

    await runAgenticLoop({
      registry: reg,
      aiDriver: driver,
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>;
      expect(row).toHaveProperty('step');
      expect(row).toHaveProperty('recorded_at');
      expect(row).toHaveProperty('depth');
      expect(row).toHaveProperty('gate_decision');
      expect(row).toHaveProperty('arg_validation');
      expect(row).toHaveProperty('result_validation');
      expect(row).toHaveProperty('invoke_status');
      expect(row).toHaveProperty('budget_snapshot');
      expect(row).toHaveProperty('policy_snapshot_hash');
      expect(row).toHaveProperty('descriptor_schema_version_hash');
      expect(row).toHaveProperty('state_view_digest');
    }
  });

  it('no raw secret appears in any trace row (c)', async () => {
    const reg = createToolRegistry();
    reg.register(emailEmittingTool());
    const { driver } = capturingDriver();
    const artifactDir = await tmpDir();

    await runAgenticLoop({
      registry: reg,
      aiDriver: driver,
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf8');
    expect(raw).not.toContain(RAW_EMAIL);
  });

  it('subagent_depth is never > 1 (D6 audit invariant)', async () => {
    const reg = createToolRegistry();
    reg.register(emailEmittingTool());
    const { driver } = capturingDriver();
    const artifactDir = await tmpDir();

    await runAgenticLoop({
      registry: reg,
      aiDriver: driver,
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const raw = await fs.readFile(tracePath, 'utf8');
    const lines = raw.trim().split('\n');
    for (const line of lines) {
      const row = JSON.parse(line) as { subagent_depth?: number };
      if (row.subagent_depth !== undefined) {
        expect(row.subagent_depth).toBeLessThanOrEqual(1);
      }
    }
  });
});
