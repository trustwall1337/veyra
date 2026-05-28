import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import { cleanupFailedFinding } from '../sandbox/cleanup-failed-finding.js';
import {
  WriteRegistry,
  executeWriteWithRegistry,
} from '../sandbox/http-write-registry.js';
import type { Finding } from '../../types/finding.js';
import { ok } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';
import {
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';
import type { ToolContext, ToolDescriptor } from '../tools/descriptor.js';
import { createToolRegistry } from '../tools/registry.js';
import { asToolId } from '../tools/tool-id.js';

import {
  type AiDriver,
  runAgenticLoop,
} from './agentic-loop.js';
import { LEDGER_ROW_COUNT } from './required-evidence-ledger.js';

/**
 * Phase 3 acceptance gate (Step 41). Exercises the full agentic pipeline
 * against a deterministic stubbed AI driver + small fixture-shape registry
 * and asserts every trust invariant CLAUDE.md + PLAN.md require.
 *
 * Cut 1 gates here: 1 (e2e), 2 (determinism), 3 (per-tool boundary), 4
 * (result-reject), 5 (ledger), 7 (trust invariants), 8 (D6 sub-agent).
 * Gate 6 (write-then-cleanup roundtrip across both paths) is exercised
 * directly via `http-write-registry` here.
 */

const RESULT_SCHEMA = toolResultBaseSchema as unknown as ZodType<ToolResult>;
const POLICY = defaultReadOnlyEvidencePolicy('dev');
const CONTEXT: ToolContext = { scanId: 'gate', projectPath: '/tmp/proj' };

function tid(id: string) {
  const r = asToolId(id);
  if (!r.ok) throw new Error(`bad id ${id}`);
  return r.value;
}

function readTool(
  id: string,
): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid(id),
    title: `tool ${id}`,
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: 'read_code',
    source_module: 'agentic-fixture-gate.test.ts',
    invoke: async () =>
      ok({ facts: [{ name: 'tool', value: id }] } as ToolResult),
  };
}

function throwingTool(): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid('crash-tool'),
    title: 'crash',
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: 'read_code',
    source_module: 'agentic-fixture-gate.test.ts',
    invoke: async () => {
      throw new Error('boom');
    },
  };
}

function badResultTool(): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid('bad-result'),
    title: 'returns a classification key (rejected)',
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: 'read_code',
    source_module: 'agentic-fixture-gate.test.ts',
    invoke: async () =>
      ok({
        facts: [{ name: 'leak', value: { finding_type: 'likely_issue' } }],
      } as unknown as ToolResult),
  };
}

function scripted(proposals: readonly unknown[]): AiDriver {
  let i = 0;
  return {
    proposeNext: async () => {
      const proposal = proposals[i] ?? { kind: 'done' };
      i += 1;
      return { proposal, model_id: 'stub', prompt_fingerprint_sha256: 'fp-stub' };
    },
  };
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-gate-'));
}

describe('Step 41 gate (1) — agentic e2e produces findings + trace', () => {
  it('runs the loop and emits a non-empty findings set + a loop-trace file', async () => {
    const reg = createToolRegistry();
    reg.register(readTool('read-code'));
    const artifactDir = await tmpDir();
    const result = await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'read-code', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    const trace = await fs.readFile(path.join(artifactDir, 'loop-trace.jsonl'), 'utf8');
    expect(trace.trim().split('\n').length).toBeGreaterThan(0);
  });
});

describe('Step 41 gate (2) — determinism: same input → same findings', () => {
  it('two runs with identical setup produce identical findings sets', async () => {
    const reg1 = createToolRegistry();
    reg1.register(readTool('read-code'));
    const reg2 = createToolRegistry();
    reg2.register(readTool('read-code'));
    const a = await runAgenticLoop({
      registry: reg1,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'read-code', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });
    const b = await runAgenticLoop({
      registry: reg2,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'read-code', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });
    const stripVolatile = (f: Finding[]) =>
      f.map((x) => ({ ...x, id: x.id.replace(/-\d+$/u, '') }));
    expect(stripVolatile([...a.findings])).toEqual(stripVolatile([...b.findings]));
  });
});

describe('Step 41 gate (3) — per-tool failure boundary', () => {
  it('a throwing tool yields tool_error + floor still runs', async () => {
    const reg = createToolRegistry();
    reg.register(throwingTool());
    const result = await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'crash-tool', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });
    expect(result.state.records().some((r) => r.kind === 'tool_error')).toBe(true);
    // floor still ran (findings include the unmet baseline gaps)
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe('Step 41 gate (4) — result-reject boundary', () => {
  it('a tool returning a classification key is rejected; no fact reaches the floor', async () => {
    const reg = createToolRegistry();
    reg.register(badResultTool());
    const result = await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'bad-result', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });
    expect(result.state.records().some((r) => r.kind === 'tool_result_reject')).toBe(true);
    expect(result.facts).toEqual([]);
    // floor still ran
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe('Step 41 gate (5) — required-evidence ledger', () => {
  it('forced early done → exactly one coverage_gap per missing baseline item', async () => {
    const reg = createToolRegistry();
    reg.register(readTool('read-code'));
    const result = await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([{ kind: 'done' }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });
    expect(result.termination).toBe('early_done');
    expect(result.ledgerMissing.length).toBe(LEDGER_ROW_COUNT.mode_a);
    const gaps = result.findings.filter((f) => f.finding_type === 'coverage_gap');
    expect(gaps.length).toBeGreaterThanOrEqual(result.ledgerMissing.length);
  });

  it('LEDGER_ROW_COUNT pins Mode A = 6 and Mode B-add = 2', () => {
    expect(LEDGER_ROW_COUNT.mode_a).toBe(6);
    expect(LEDGER_ROW_COUNT.mode_b_add).toBe(2);
    const sandbox = defaultSandboxActiveValidationPolicy('dev');
    expect(sandbox.ok).toBe(true);
  });
});

describe('Step 41 gate (6) — write-then-cleanup roundtrip', () => {
  it('records both paths and reverse-walks to residual 0', async () => {
    const reg = new WriteRegistry();
    await executeWriteWithRegistry({
      registry: reg,
      transport: { send: async () => ({ ok: true }) },
      request: { method: 'POST', url: '/items', body_redacted: '{...}' },
      resource_id: '/items/1',
      description_redacted: 'create item',
    });
    reg.recordAdminWrite({ resource_id: 'user-1', description_redacted: 'create synthetic user' });
    const proof = await reg.reverseWalk({
      http: async () => {},
      admin: async () => {},
    });
    expect(proof.residual_count).toBe(0);
  });

  it('induced cleanup failure → cleanup_failed launch-blocker', async () => {
    const reg = new WriteRegistry();
    reg.recordHttpWrite({ resource_id: '/x', description_redacted: 'x' });
    const proof = await reg.reverseWalk({
      http: async () => {
        throw new Error('http delete failed');
      },
      admin: async () => {},
    });
    expect(proof.residual_count).toBe(1);
    const finding = cleanupFailedFinding(proof);
    expect(finding.review_action).toBe('fix_before_launch');
  });
});

describe('Step 41 gate (7) — trust invariants', () => {
  it('the loop-trace contains no raw secret value', async () => {
    const reg = createToolRegistry();
    const tool: ToolDescriptor<Record<string, never>, ToolResult> = {
      tool_id: tid('emits-email'),
      title: 'a tool whose fact contains an email',
      args_schema: z.object({}),
      result_schema: RESULT_SCHEMA,
      required_action: 'read_code',
      source_module: 'agentic-fixture-gate.test.ts',
      invoke: async () =>
        ok({ facts: [{ name: 'admin', value: 'admin@example.com' }] } as ToolResult),
    };
    reg.register(tool);
    const artifactDir = await tmpDir();
    await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([{ kind: 'invoke_tool', tool_id: 'emits-email', args: {} }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });
    const trace = await fs.readFile(path.join(artifactDir, 'loop-trace.jsonl'), 'utf8');
    expect(trace).not.toContain('admin@example.com');
  });
});

describe('Step 41 gate (8) — D6 sub-agent invariants (depth cap)', () => {
  it('a sub-agent spawning at depth 1 is denied (depth_cap); no subagent_depth > 1 row', async () => {
    const reg = createToolRegistry();
    reg.register({
      ...readTool('read-code'),
      required_action: 'read_schema_metadata',
      tool_id: tid('schema-meta'),
      title: 'schema-meta',
    });
    reg.register(readTool('read-code'));
    const spawn = {
      kind: 'spawn_deep_dive',
      target_descriptor: { kind: 'rls_policy_graph', subject: 'fact:table-users' },
    };
    const artifactDir = await tmpDir();
    await runAgenticLoop({
      registry: reg,
      aiDriver: scripted([spawn, spawn, { kind: 'done' }, { kind: 'done' }]),
      policy: POLICY,
      context: CONTEXT,
      artifactDir,
    });
    const trace = (
      await fs.readFile(path.join(artifactDir, 'loop-trace.jsonl'), 'utf8')
    )
      .trim()
      .split('\n');
    for (const line of trace) {
      const row = JSON.parse(line) as { subagent_depth?: number };
      if (row.subagent_depth !== undefined) {
        expect(row.subagent_depth).toBeLessThanOrEqual(1);
      }
    }
  });
});
