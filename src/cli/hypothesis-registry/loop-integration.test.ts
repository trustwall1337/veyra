import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runAgenticLoop } from '../../core/orchestrator/agentic-loop.js';
import type {
  AiDriver,
  AiProposalEnvelope,
} from '../../core/orchestrator/agentic-loop.js';
import type { LoopView } from '../../core/orchestrator/artifact-state.js';
import { createToolRegistry } from '../../core/tools/registry.js';
import type { ValidationPolicy } from '../../types/validation-policy.js';

import { HypothesisRegistry } from './registry.js';

function stubPolicy(): ValidationPolicy {
  return {
    mode: 'read_only_evidence',
    environment: 'local',
    allowed_actions: new Set(['read_code', 'author_hypothesis']),
    forbidden_actions: new Set(),
    approval: { required: false },
  };
}

describe('V3 — view.hypotheses reaches every proposeNext', () => {
  it('every proposeNext call receives the current hypothesis snapshot', async () => {
    const reg = new HypothesisRegistry({
      now: () => Date.parse('2026-06-12T08:00:00.000Z'),
    });
    reg.propose({ statement: 'seeded hypothesis', confidence: 'low' });

    const seen: (readonly { hypothesis_id: string }[] | undefined)[] = [];
    const driver: AiDriver = {
      proposeNext: async (view: LoopView): Promise<AiProposalEnvelope> => {
        seen.push(view.hypotheses?.map((h) => ({ hypothesis_id: h.hypothesis_id })));
        return { proposal: { kind: 'done' } };
      },
    };

    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v3-'),
    );
    await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-1', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const s of seen) {
      expect(s).toBeDefined();
      expect(s?.length).toBe(1);
      expect(s?.[0]?.hypothesis_id).toBe('hyp_000001');
    }
  });

  it('view.hypotheses is undefined when no registry is supplied (legacy path)', async () => {
    const seen: (readonly unknown[] | undefined)[] = [];
    const driver: AiDriver = {
      proposeNext: async (view: LoopView): Promise<AiProposalEnvelope> => {
        seen.push(view.hypotheses);
        return { proposal: { kind: 'done' } };
      },
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v3b-'),
    );
    await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-2', projectPath: artifactDir, artifactDir },
      artifactDir,
    });
    for (const s of seen) expect(s).toBeUndefined();
  });
});

describe('V12 — hypothesis_count carried by terminal row only (NOT row 0)', () => {
  it('terminal row carries hypothesis_count; row 0 does not', async () => {
    const reg = new HypothesisRegistry({
      now: () => Date.parse('2026-06-12T08:00:00.000Z'),
    });
    reg.propose({ statement: 'a', confidence: 'low' });
    reg.propose({ statement: 'b', confidence: 'medium' });
    reg.propose({ statement: 'c', confidence: 'high' });

    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => ({
        proposal: { kind: 'done' },
      }),
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v12-'),
    );
    await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-3', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const text = await fs.readFile(tracePath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Row 0 does NOT carry hypothesis_count
    expect(rows[0]?.hypothesis_count).toBeUndefined();

    // Terminal row (the last one) DOES carry it, and equals the snapshot length
    const terminal = rows[rows.length - 1];
    expect(terminal?.hypothesis_count).toBe(3);

    // No intermediate row carries it
    for (let i = 0; i < rows.length - 1; i += 1) {
      expect(rows[i]?.hypothesis_count).toBeUndefined();
    }
  });

  it('terminal row hypothesis_count=0 when no hypotheses authored', async () => {
    const reg = new HypothesisRegistry({
      now: () => Date.parse('2026-06-12T08:00:00.000Z'),
    });
    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => ({
        proposal: { kind: 'done' },
      }),
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v12b-'),
    );
    await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: stubPolicy(),
      context: { scanId: 'sc-4', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });
    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const text = await fs.readFile(tracePath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows[rows.length - 1]?.hypothesis_count).toBe(0);
  });
});

describe('V8b — author_hypothesis policy-gate two-direction test (codex 40e-diff-004 [APPLIED])', () => {
  it('a policy WITH author_hypothesis allows propose-hypothesis → registry mutates', async () => {
    const reg = new HypothesisRegistry({ now: () => 0 });
    const registry = createToolRegistry();
    const { registerHypothesisTools } = await import('../tool-registration.js');
    registerHypothesisTools(registry, {
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });

    let propsCount = 0;
    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => {
        propsCount += 1;
        if (propsCount === 1) {
          return {
            proposal: {
              kind: 'invoke_tool',
              tool_id: 'propose-hypothesis',
              args: {
                statement: 'an observed multi-tenant pattern',
                confidence: 'medium',
              },
            },
          };
        }
        return { proposal: { kind: 'done' } };
      },
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v8b-allow-'),
    );
    await runAgenticLoop({
      registry,
      aiDriver: driver,
      policy: {
        mode: 'read_only_evidence',
        environment: 'local',
        allowed_actions: new Set(['read_code', 'author_hypothesis']),
        forbidden_actions: new Set(),
        approval: { required: false },
      },
      context: { scanId: 'sc-allow', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });
    // Registry mutated → one entry landed.
    expect(reg.snapshot().length).toBe(1);
    expect(reg.snapshot()[0]?.statement).toContain('multi-tenant');
  });

  it('a policy WITHOUT author_hypothesis denies propose-hypothesis at the gate → registry empty', async () => {
    const reg = new HypothesisRegistry({ now: () => 0 });
    const registry = createToolRegistry();
    const { registerHypothesisTools } = await import('../tool-registration.js');
    registerHypothesisTools(registry, {
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });

    let propsCount = 0;
    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => {
        propsCount += 1;
        if (propsCount === 1) {
          return {
            proposal: {
              kind: 'invoke_tool',
              tool_id: 'propose-hypothesis',
              args: { statement: 'pattern', confidence: 'low' },
            },
          };
        }
        return { proposal: { kind: 'done' } };
      },
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v8b-deny-'),
    );
    await runAgenticLoop({
      registry,
      aiDriver: driver,
      policy: {
        mode: 'read_only_evidence',
        environment: 'local',
        // Note: NO 'author_hypothesis' — strict-audit custom policy.
        allowed_actions: new Set(['read_code']),
        forbidden_actions: new Set(),
        approval: { required: false },
      },
      context: { scanId: 'sc-deny', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });
    // Registry untouched because the gate denied the call before invoke.
    expect(reg.snapshot().length).toBe(0);

    // Trace should record a `denial` row for the rejected call.
    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const text = await fs.readFile(tracePath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const denialRow = rows.find(
      (r) => r.tool_id === 'propose-hypothesis' && r.gate_decision === 'deny',
    );
    expect(denialRow).toBeDefined();
  });
});

describe('V4 / V5 trace-row-kind assertions (codex 40e-diff-002 [APPLIED])', () => {
  it('prewrite scalar-string reject lands as tool_error with the right error_class', async () => {
    const reg = new HypothesisRegistry({ now: () => 0 });
    const registry = createToolRegistry();
    const { registerHypothesisTools } = await import('../tool-registration.js');
    registerHypothesisTools(registry, {
      registry: reg,
      redactor: (raw) => raw,
      isAcceptedStepRef: () => true,
    });

    let propsCount = 0;
    const driver: AiDriver = {
      proposeNext: async (): Promise<AiProposalEnvelope> => {
        propsCount += 1;
        if (propsCount === 1) {
          return {
            proposal: {
              kind: 'invoke_tool',
              tool_id: 'propose-hypothesis',
              args: {
                statement: 'I think finding_type is at risk here',
                confidence: 'medium',
              },
            },
          };
        }
        return { proposal: { kind: 'done' } };
      },
    };
    const artifactDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'veyra-40e-v4-trace-'),
    );
    await runAgenticLoop({
      registry,
      aiDriver: driver,
      policy: {
        mode: 'read_only_evidence',
        environment: 'local',
        allowed_actions: new Set(['read_code', 'author_hypothesis']),
        forbidden_actions: new Set(),
        approval: { required: false },
      },
      context: { scanId: 'sc-v4', projectPath: artifactDir, artifactDir },
      artifactDir,
      hypothesisRegistry: reg,
    });
    expect(reg.snapshot().length).toBe(0);

    const tracePath = path.join(artifactDir, 'loop-trace.jsonl');
    const text = await fs.readFile(tracePath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // The propose-hypothesis call must produce a row with invoke_status=error
    // and tool_error_class=ClassificationKeyInArgsError (Result.err from
    // invoke → recordToolError per agentic-loop.ts wiring).
    const errorRow = rows.find(
      (r) =>
        r.tool_id === 'propose-hypothesis' &&
        r.tool_error_class === 'ClassificationKeyInArgsError',
    );
    expect(errorRow).toBeDefined();
  });
});
