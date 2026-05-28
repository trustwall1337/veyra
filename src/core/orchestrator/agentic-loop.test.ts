import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { Finding } from '../../types/finding.js';
import { type Result, ok } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';
import {
  type AllowedAction,
  defaultReadOnlyEvidencePolicy,
} from '../../types/validation-policy.js';
import type { ToolDescriptor, ToolContext } from '../tools/descriptor.js';
import { ToolInvocationError } from '../tools/descriptor.js';
import { createToolRegistry, type ToolRegistry } from '../tools/registry.js';
import { asToolId } from '../tools/tool-id.js';

import {
  type AiDriver,
  type DeriveSubScope,
  runAgenticLoop,
} from './agentic-loop.js';

const RESULT_SCHEMA = toolResultBaseSchema as unknown as ZodType<ToolResult>;
const POLICY = defaultReadOnlyEvidencePolicy('dev');
const CONTEXT: ToolContext = { scanId: 's1', projectPath: '/tmp/proj' };

const SENTINEL: Finding = {
  id: 'floor-ran',
  control_id: 'cc-test',
  finding_type: 'informational',
  evidence_strength: 'low',
  reproducibility: 'static',
  review_action: 'monitor',
  blast_radius: 'unknown',
  title: 'floor ran',
  summary: 'sentinel proving the floor executed',
  evidence_refs: [],
};

function toolId(id: string) {
  const r = asToolId(id);
  if (!r.ok) throw new Error(`bad id ${id}`);
  return r.value;
}

function makeTool(
  id: string,
  action: AllowedAction,
  invoke: () => Promise<Result<ToolResult, ToolInvocationError>>,
): { descriptor: ToolDescriptor<unknown, ToolResult>; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    descriptor: {
      tool_id: toolId(id),
      title: id,
      args_schema: z.object({}),
      result_schema: RESULT_SCHEMA,
      required_action: action,
      source_module: 'agentic-loop.test.ts',
      invoke: async () => {
        n += 1;
        return invoke();
      },
    },
  };
}

function scriptedDriver(proposals: readonly unknown[]): AiDriver {
  let i = 0;
  return {
    proposeNext: async () => {
      if (i < proposals.length) {
        const proposal = proposals[i];
        i += 1;
        return { proposal };
      }
      return { proposal: { kind: 'done' } };
    },
  };
}

async function tmpArtifactDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-loop-'));
}

async function run(
  registry: ToolRegistry,
  driver: AiDriver,
  extra: Partial<Parameters<typeof runAgenticLoop>[0]> = {},
) {
  return runAgenticLoop({
    registry,
    aiDriver: driver,
    policy: POLICY,
    context: CONTEXT,
    artifactDir: await tmpArtifactDir(),
    runFloor: () => [SENTINEL],
    ...extra,
  });
}

describe('agentic loop — proposal validation (Verification a)', () => {
  it('rejects a malformed proposal and never executes a tool', async () => {
    const reg = createToolRegistry();
    const ok = makeTool('read-code', 'read_code', async () =>
      okResult([{ name: 'f', value: 'app.ts' }]),
    );
    reg.register(ok.descriptor);
    const res = await run(reg, scriptedDriver([{ kind: 'frobnicate' }]));
    expect(res.state.records().some((r) => r.kind === 'invalid_proposal')).toBe(
      true,
    );
    expect(ok.calls()).toBe(0);
  });
});

describe('agentic loop — per-tool failure boundary (Verification b)', () => {
  it('a throwing tool records tool_error, never rethrows, floor still runs', async () => {
    const reg = createToolRegistry();
    const crash = makeTool('crash', 'read_code', async () => {
      throw new Error('boom');
    });
    reg.register(crash.descriptor);
    const res = await run(
      reg,
      scriptedDriver([{ kind: 'invoke_tool', tool_id: 'crash', args: {} }]),
    );
    const rec = res.state.records().find((r) => r.kind === 'tool_error');
    expect(rec?.tool_id).toBe('crash');
    expect(rec?.reason).toBe('Error');
    // floor ran in every path:
    expect(res.findings).toEqual([SENTINEL]);
  });
});

describe('agentic loop — result-parse-or-reject boundary (Verification c)', () => {
  it('a result failing the schema is rejected; no fact reaches the floor', async () => {
    const reg = createToolRegistry();
    // Returns a classification-bearing object → result_schema rejects.
    const bad = makeTool('bad', 'read_code', async () =>
      ok({
        facts: [{ name: 'x', value: { review_action: 'fix_before_launch' } }],
      } as unknown as ToolResult),
    );
    reg.register(bad.descriptor);
    const res = await run(
      reg,
      scriptedDriver([{ kind: 'invoke_tool', tool_id: 'bad', args: {} }]),
    );
    const rec = res.state.records().find((r) => r.kind === 'tool_result_reject');
    expect(rec?.tool_id).toBe('bad');
    expect(res.state.toolSucceeded('bad')).toBe(false);
    expect(res.facts).toEqual([]);
    // reason only, no raw payload
    expect(JSON.stringify(rec)).not.toContain('fix_before_launch');
  });
});

describe('agentic loop — denial path', () => {
  it('a tool whose required_action is forbidden is denied, not invoked', async () => {
    const reg = createToolRegistry();
    const mutate = makeTool('mutate', 'create_synthetic_user', async () =>
      okResult([]),
    );
    reg.register(mutate.descriptor);
    const res = await run(
      reg,
      scriptedDriver([{ kind: 'invoke_tool', tool_id: 'mutate', args: {} }]),
    );
    expect(res.state.records().some((r) => r.kind === 'denial')).toBe(true);
    expect(mutate.calls()).toBe(0);
  });
});

describe('agentic loop — budget + termination (Verification d)', () => {
  it('trips max_tool_calls and halts', async () => {
    const reg = createToolRegistry();
    const okt = makeTool('read-code', 'read_code', async () =>
      okResult([{ name: 'f', value: 1 }]),
    );
    reg.register(okt.descriptor);
    const res = await run(
      reg,
      scriptedDriver([
        { kind: 'invoke_tool', tool_id: 'read-code', args: {} },
        { kind: 'invoke_tool', tool_id: 'read-code', args: {} },
      ]),
      { caps: { max_tool_calls: 1 } },
    );
    expect(res.termination).toBe('budget_halt');
  });

  it('trips the wall-clock cap and halts (floor still runs)', async () => {
    const reg = createToolRegistry();
    reg.register(
      makeTool('read-code', 'read_code', async () => okResult([])).descriptor,
    );
    const res = await run(reg, scriptedDriver([]), {
      caps: { max_wall_clock_ms: 0 },
    });
    expect(res.termination).toBe('budget_halt');
    expect(res.findings).toEqual([SENTINEL]);
  });

  it('stall-halts when no progress is made within the window', async () => {
    const reg = createToolRegistry();
    const alwaysInvalid: AiDriver = {
      proposeNext: async () => ({ proposal: { kind: 'nope' } }),
    };
    const res = await run(reg, alwaysInvalid, { stallWindow: 2 });
    expect(res.termination).toBe('stall_halt');
  });

  it('done runs the floor', async () => {
    const reg = createToolRegistry();
    const res = await run(reg, scriptedDriver([]));
    expect(res.findings).toEqual([SENTINEL]);
  });
});

describe('agentic loop — early_done (Verification e)', () => {
  it('a premature done with an unmet baseline records early_done', async () => {
    const reg = createToolRegistry();
    const res = await run(reg, scriptedDriver([]));
    expect(res.state.records().some((r) => r.kind === 'early_done')).toBe(true);
    expect(res.termination).toBe('early_done');
    expect(res.ledgerMissing.length).toBeGreaterThan(0);
  });
});

describe('agentic loop — D6 deep-dive', () => {
  const spawn = {
    kind: 'spawn_deep_dive',
    target_descriptor: { kind: 'rls_policy_graph', subject: 'fact:table-users' },
  };

  // Build a registry whose parent scope strictly contains the rls_policy_graph
  // sub-scope: one schema-meta tool (matches scope), one read-code tool (does
  // not), so subset is non-empty and parent.size > sub.size.
  function regWithSubsetTools() {
    const reg = createToolRegistry();
    reg.register(
      makeTool('schema-meta', 'read_schema_metadata', async () => okResult([])).descriptor,
    );
    reg.register(
      makeTool('read-code', 'read_code', async () => okResult([])).descriptor,
    );
    return reg;
  }

  it('spawns a sub-agent at depth 0 and runs it at depth 1', async () => {
    const reg = regWithSubsetTools();
    const res = await run(reg, scriptedDriver([spawn, { kind: 'done' }]));
    // A child record exists at depth 1.
    expect(res.state.records().some((r) => r.depth === 1)).toBe(true);
  });

  it('enforces the depth cap: a sub-agent cannot spawn again', async () => {
    const reg = regWithSubsetTools();
    // depth0 spawn → child; child tries to spawn → denied at depth 1.
    const res = await run(
      reg,
      scriptedDriver([spawn, spawn, { kind: 'done' }, { kind: 'done' }]),
    );
    const denial = res.state
      .records()
      .find((r) => r.kind === 'spawn_denial' && r.depth === 1);
    expect(denial?.reason).toBe('depth_cap');
  });

  it('parent-side catch records subagent_error on a scope-derivation throw', async () => {
    const reg = regWithSubsetTools();
    const throwingScope: DeriveSubScope = () => {
      throw new Error('scope boom');
    };
    const res = await run(reg, scriptedDriver([spawn]), {
      deriveSubScope: throwingScope,
    });
    expect(
      res.state.records().some((r) => r.kind === 'subagent_error'),
    ).toBe(true);
    // The parent still reaches its floor.
    expect(res.findings).toEqual([SENTINEL]);
  });
});

function okResult(facts: ToolResult['facts']): Result<ToolResult, ToolInvocationError> {
  return ok({ facts });
}
