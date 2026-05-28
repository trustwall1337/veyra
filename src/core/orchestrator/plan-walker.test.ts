import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type ZodType, z } from 'zod';
import { describe, expect, it } from 'vitest';

import type { Finding } from '../../types/finding.js';
import { ok } from '../../types/result.js';
import {
  type ToolResult,
  toolResultBaseSchema,
} from '../../types/tool-result.js';
import {
  type AllowedAction,
  defaultReadOnlyEvidencePolicy,
  defaultSandboxActiveValidationPolicy,
} from '../../types/validation-policy.js';
import type { ToolContext, ToolDescriptor } from '../tools/descriptor.js';
import { createToolRegistry, type ToolRegistry } from '../tools/registry.js';
import { asToolId } from '../tools/tool-id.js';

import {
  type AiDriver,
  runAgenticLoop,
} from './agentic-loop.js';
import { runPlanWalker } from './plan-walker.js';

const RESULT_SCHEMA = toolResultBaseSchema as unknown as ZodType<ToolResult>;
const READ_ONLY = defaultReadOnlyEvidencePolicy('dev');
const ACTIVE = (() => {
  const r = defaultSandboxActiveValidationPolicy('dev');
  if (!r.ok) throw new Error('expected sandbox policy');
  return r.value;
})();

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
    title: `read tool ${id}`,
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: 'read_code',
    source_module: 'plan-walker.test.ts',
    invoke: async () =>
      ok({ facts: [{ name: 'from', value: id }] } as ToolResult),
  };
}

function writeProbeTool(
  id: string,
  action: AllowedAction,
): ToolDescriptor<Record<string, never>, ToolResult> {
  return {
    tool_id: tid(id),
    title: `write probe ${id}`,
    args_schema: z.object({}),
    result_schema: RESULT_SCHEMA,
    required_action: action,
    source_module: 'plan-walker.test.ts',
    invoke: async () => ok({ facts: [] } as ToolResult),
  };
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-plan-walker-'));
}

const FACTS_FINDING = (count: number): Finding => ({
  id: `floor-${count}-facts`,
  control_id: 'cc-test',
  finding_type: 'informational',
  evidence_strength: 'low',
  reproducibility: 'static',
  review_action: 'monitor',
  blast_radius: 'unknown',
  title: `floor saw ${count} facts`,
  summary: 'sentinel',
  evidence_refs: [],
});

const CONTEXT: ToolContext = { scanId: 's1', projectPath: '/tmp/p' };

describe('plan-walker (Step 32)', () => {
  it('(a) read-only parity: plan-walker matches the AI loop on the same tools', async () => {
    // Build registries: same two read-only tools.
    const planReg = createToolRegistry();
    planReg.register(readTool('tool-alpha'));
    planReg.register(readTool('tool-beta'));
    const loopReg = createToolRegistry();
    loopReg.register(readTool('tool-alpha'));
    loopReg.register(readTool('tool-beta'));

    // A scripted AI driver that proposes the same tools in the same order.
    const aiDriver: AiDriver = (() => {
      const proposals = [
        { kind: 'invoke_tool', tool_id: 'tool-alpha', args: {} },
        { kind: 'invoke_tool', tool_id: 'tool-beta', args: {} },
        { kind: 'done' },
      ];
      let i = 0;
      return {
        proposeNext: async () => ({ proposal: proposals[i++] ?? { kind: 'done' } }),
      };
    })();

    // Same floor for both: emits one finding per fact.
    const runFloor = (facts: readonly { name: string; value: unknown }[]) => [
      FACTS_FINDING(facts.length),
    ];

    const planResult = await runPlanWalker({
      registry: planReg,
      policy: READ_ONLY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
      runFloor,
    });
    const loopResult = await runAgenticLoop({
      registry: loopReg,
      aiDriver,
      policy: READ_ONLY,
      context: CONTEXT,
      artifactDir: await tmpDir(),
      runFloor,
    });

    expect(planResult.findings).toEqual(loopResult.findings);
    expect(planResult.facts).toEqual(loopResult.facts);
    expect(planResult.ledgerMissing).toEqual(loopResult.ledgerMissing);
  });

  it('(b) write-probe coverage_gap: one gap per registered write-probe tool, never invoked', async () => {
    const reg = createToolRegistry();
    let invocations = 0;
    const wpA = writeProbeTool('probe-call', 'call_api_with_test_identity');
    const wpB = writeProbeTool('probe-deny', 'verify_denial');
    const counted = (
      d: ToolDescriptor<Record<string, never>, ToolResult>,
    ): ToolDescriptor<Record<string, never>, ToolResult> => ({
      ...d,
      invoke: async (a, c, p) => {
        invocations += 1;
        return d.invoke(a, c, p);
      },
    });
    reg.register(counted(wpA));
    reg.register(counted(wpB));
    reg.register(readTool('read-thing'));

    const result = await runPlanWalker({
      registry: reg,
      policy: ACTIVE,
      context: CONTEXT,
      artifactDir: await tmpDir(),
    });

    // The floor now emits one coverage_gap per ledger gap by default — filter
    // to the write-probe-specific gaps (control_id `cc-no-ai-write-probe`).
    const writeProbeGaps = result.findings.filter(
      (f) =>
        f.finding_type === 'coverage_gap' &&
        f.control_id === 'cc-no-ai-write-probe',
    );
    expect(writeProbeGaps).toHaveLength(2);
    for (const g of writeProbeGaps) {
      expect(g.summary).toBe(
        'active write-probe requires AI planning; re-run without --no-ai',
      );
    }
    // Write probes were NEVER invoked offline.
    expect(invocations).toBe(0);
  });
});
