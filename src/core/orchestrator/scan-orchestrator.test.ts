import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AgentExecutionContext,
  AgentLogger,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import {
  CycleError,
  createScanOrchestrator,
} from './scan-orchestrator.js';

function logger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-orch-'));
  return {
    scanId: 'scan',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: logger(),
  };
}

function stubAgent(
  id: string,
  deps: readonly string[],
  options?: { throws?: boolean; findings?: readonly Finding[] },
): VeyraAgent<unknown, unknown> {
  const meta: AgentMetadata = {
    id,
    version: '0.1.0',
    declared_dependencies: deps,
  };
  return {
    metadata: meta,
    run: async (
      _input: unknown,
      _context: AgentExecutionContext,
    ): Promise<AgentResult<unknown>> => {
      if (options?.throws === true) {
        throw new Error(`boom from ${id}`);
      }
      return {
        status: 'completed',
        artifacts: [],
        findings: options?.findings ?? [],
        warnings: [],
        output: { id },
      };
    },
  };
}

describe('topological ordering', () => {
  it('runs agents in declared dependency order', async () => {
    const orch = createScanOrchestrator();
    const runOrder: string[] = [];
    function wrap(id: string, deps: readonly string[]) {
      const agent = stubAgent(id, deps);
      return {
        ...agent,
        run: async (input: unknown, c: AgentExecutionContext) => {
          runOrder.push(id);
          return agent.run(input, c);
        },
      };
    }
    orch.register(wrap('c', ['a', 'b']));
    orch.register(wrap('a', []));
    orch.register(wrap('b', ['a']));
    await orch.run(await ctx());
    expect(runOrder).toEqual(['a', 'b', 'c']);
  });

  it('rejects a dependency cycle with CycleError', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('x', ['y']));
    orch.register(stubAgent('y', ['x']));
    await expect(orch.run(await ctx())).rejects.toBeInstanceOf(CycleError);
  });

  it('ignores declared_dependencies that name external artifacts (not agent ids)', async () => {
    const orch = createScanOrchestrator();
    orch.register(
      stubAgent('a', ['some-artifact.json', 'another.json']),
    );
    const r = await orch.run(await ctx());
    expect(r.resultsByAgent.has('a')).toBe(true);
  });
});

describe('failure isolation', () => {
  it('one agent throws, others still complete; error artifact + coverage_gap emitted', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('healthy-1', []));
    orch.register(stubAgent('throws', ['healthy-1'], { throws: true }));
    orch.register(stubAgent('healthy-2', []));
    const c = await ctx();
    const r = await orch.run(c);
    expect(r.status).toBe('completed');
    expect(r.resultsByAgent.has('healthy-1')).toBe(true);
    expect(r.resultsByAgent.has('healthy-2')).toBe(true);
    expect(r.resultsByAgent.has('throws')).toBe(false);
    const coverageGap = r.findings.find(
      (f) => f.id === 'orchestrator-throws-coverage-gap',
    );
    expect(coverageGap).toBeDefined();
    expect(coverageGap?.finding_type).toBe('coverage_gap');
    // The error artifact must be on disk.
    const written = await fs.readdir(c.artifactDir);
    expect(written).toContain('agent-throws.error.json');
  });

  it('warning carries the offending agent id', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('bad', [], { throws: true }));
    const r = await orch.run(await ctx());
    expect(r.warnings.some((w) => w.includes('bad'))).toBe(true);
  });
});

describe('determinism', () => {
  it('same registration order + context → same execution order', async () => {
    const orderA: string[] = [];
    const orderB: string[] = [];
    function build(into: string[]) {
      const orch = createScanOrchestrator();
      for (const id of ['c', 'a', 'b']) {
        const agent = stubAgent(id, id === 'b' ? ['a'] : id === 'c' ? ['a', 'b'] : []);
        orch.register({
          metadata: agent.metadata,
          run: async (input, c2) => {
            into.push(id);
            return agent.run(input, c2);
          },
        });
      }
      return orch;
    }
    const ca = await ctx();
    const cb = await ctx();
    await build(orderA).run(ca);
    await build(orderB).run(cb);
    expect(orderA).toEqual(orderB);
  });
});

describe('parallel batching — determinism (step 18b)', () => {
  it('concurrency=1 and concurrency=4 produce identical sorted finding sets', async () => {
    function buildOrch(concurrency: number) {
      const orch = createScanOrchestrator({ maxConcurrency: concurrency });
      // Independent agents in the same layer so concurrency actually
      // exercises the batching path.
      for (const id of ['agent-a', 'agent-b', 'agent-c', 'agent-d']) {
        orch.register(
          stubAgent(id, [], {
            findings: [
              {
                id: `f-${id}`,
                control_id: 'cc-11-3',
                finding_type: 'likely_issue',
                evidence_strength: 'medium',
                reproducibility: 'static',
                review_action: 'review_before_launch',
                blast_radius: 'tenant_data',
                title: id,
                summary: id,
                evidence_refs: [],
              },
            ],
          }),
        );
      }
      return orch;
    }
    const r1 = await buildOrch(1).run(await ctx());
    const r4 = await buildOrch(4).run(await ctx());
    const ids1 = r1.findings.map((f) => f.id).sort();
    const ids4 = r4.findings.map((f) => f.id).sort();
    expect(ids1).toEqual(ids4);
  });

  it('two predicates that throw produce the same final coverage_gap set regardless of concurrency', async () => {
    function buildOrch(concurrency: number) {
      const orch = createScanOrchestrator({ maxConcurrency: concurrency });
      orch.register(stubAgent('healthy', []));
      orch.register(stubAgent('thrower-1', [], { throws: true }));
      orch.register(stubAgent('thrower-2', [], { throws: true }));
      return orch;
    }
    const r1 = await buildOrch(1).run(await ctx());
    const r2 = await buildOrch(3).run(await ctx());
    const ids1 = r1.findings.map((f) => f.id).sort();
    const ids2 = r2.findings.map((f) => f.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it('writes scan-trace.json with agent_id + layer per agent', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('a', []));
    orch.register(stubAgent('b', ['a']));
    const c = await ctx();
    await orch.run(c);
    const text = await fs.readFile(
      path.join(c.artifactDir, 'scan-trace.json'),
      'utf8',
    );
    const parsed = JSON.parse(text) as {
      layers: number;
      trace: { agent_id: string; layer: number; status: string }[];
    };
    expect(parsed.trace.find((t) => t.agent_id === 'a')?.layer).toBe(0);
    expect(parsed.trace.find((t) => t.agent_id === 'b')?.layer).toBe(1);
  });
});

describe('Pass-2 wiring (18b retro-fix)', () => {
  function hyp(id: string, control_id: string, factId: string) {
    return {
      hypothesis_id: id,
      source: 'ai_inference' as const,
      proposed_control_id: control_id,
      evidence_refs: [{ fact_id: factId }],
      reasoning: `r-${id}`,
      confidence: 'medium' as const,
      uncertainty_notes: 'n',
      model_id: 'm',
      prompt_fingerprint_sha256: '0'.repeat(64),
    };
  }

  it('runs disposeHypotheses after Pass-1 and writes assertions.json + ai-concerns.json', async () => {
    const orch = createScanOrchestrator({
      ai: {
        collectHypotheses: () => [hyp('h1', 'cc-11-9', 'f-unknown')],
      },
    });
    orch.register(
      stubAgent('seed', [], {
        findings: [
          {
            id: 'f-1',
            control_id: 'cc-11-5',
            finding_type: 'likely_issue',
            evidence_strength: 'medium',
            reproducibility: 'static',
            review_action: 'review_before_launch',
            blast_radius: 'tenant_data',
            title: 't',
            summary: 's',
            evidence_refs: ['f-1'],
          },
        ],
      }),
    );
    const c = await ctx();
    const r = await orch.run(c);
    expect(r.aiConcerns.length).toBe(1);
    const written = await fs.readdir(c.artifactDir);
    expect(written).toContain('assertions.json');
    expect(written).toContain('ai-concerns.json');
  });

  it('context-request retry cap: hypothesis falls through to rule 4 after cap retries', async () => {
    // Evaluator grants but never resolves the hypothesis — the same
    // request is re-emitted each iteration, so the cap controls how
    // many retries occur before forced exhaustion.
    let evaluations = 0;
    const orch = createScanOrchestrator({
      contextRetryCap: 2,
      ai: {
        collectHypotheses: () => [
          {
            ...hyp('h1', 'cc-11-9', 'f-x'),
            requires_context: {
              request_id: 'r1',
              for_hypothesis_id: 'h1',
              justification: 'need more',
              kind: 'read_file' as const,
              args: { kind: 'read_file' as const, path: 'src/x.ts' },
            },
          },
        ],
        evaluateContextRequest: async () => {
          evaluations += 1;
          return { granted: true };
        },
      },
    });
    orch.register(stubAgent('seed', []));
    const c = await ctx();
    const r = await orch.run(c);
    expect(r.contextRetryCount).toBe(2);
    expect(evaluations).toBe(2);
    expect(r.aiConcerns.length).toBe(1);
  });

  it('context-request denied → hypothesis falls through to rule 4 immediately', async () => {
    const orch = createScanOrchestrator({
      contextRetryCap: 2,
      ai: {
        collectHypotheses: () => [
          {
            ...hyp('h1', 'cc-11-9', 'f-x'),
            requires_context: {
              request_id: 'r1',
              for_hypothesis_id: 'h1',
              justification: 'need more',
              kind: 'read_file' as const,
              args: { kind: 'read_file' as const, path: 'src/x.ts' },
            },
          },
        ],
        evaluateContextRequest: async () => ({ granted: false, reason: 'denylist' }),
      },
    });
    orch.register(stubAgent('seed', []));
    const c = await ctx();
    const r = await orch.run(c);
    // Denial on the first retry exhausts the hypothesis; the
    // re-dispose moves it to rule 4. Cap not reached.
    expect(r.contextRetryCount).toBe(1);
    expect(r.aiConcerns.length).toBe(1);
  });

  it('AI disabled → no aiConcerns, no assertions.json, no ai-concerns.json', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('seed', []));
    const c = await ctx();
    const r = await orch.run(c);
    expect(r.aiConcerns.length).toBe(0);
    expect(r.contextRetryCount).toBe(0);
    const written = await fs.readdir(c.artifactDir);
    expect(written).not.toContain('assertions.json');
    expect(written).not.toContain('ai-concerns.json');
  });

  it('scan-actions.log records mid-scan agent throws', async () => {
    const orch = createScanOrchestrator();
    orch.register(stubAgent('bad', [], { throws: true }));
    const c = await ctx();
    await orch.run(c);
    const log = await fs.readFile(
      path.join(c.artifactDir, 'scan-actions.log'),
      'utf8',
    );
    expect(log).toContain('"event":"agent_threw"');
    expect(log).toContain('"agent_id":"bad"');
  });

  it('byte-determinism: same input → byte-identical findings.json + ai-concerns.json (scrubbed)', async () => {
    function scrub(s: string): string {
      // strip timestamps + scan ids so the comparison ignores
      // run-specific values.
      return s
        .replace(/"observed_at":"[^"]+"/g, '"observed_at":"<scrubbed>"')
        .replace(/"recorded_at":"[^"]+"/g, '"recorded_at":"<scrubbed>"')
        .replace(/"generated_at":"[^"]+"/g, '"generated_at":"<scrubbed>"')
        .replace(/"scanId":"[^"]+"/g, '"scanId":"<scrubbed>"');
    }
    function build(concurrency: number) {
      const orch = createScanOrchestrator({
        maxConcurrency: concurrency,
        ai: {
          collectHypotheses: () => [hyp('h1', 'cc-11-9', 'f-x')],
        },
      });
      for (const id of ['a', 'b', 'c']) {
        orch.register(stubAgent(id, []));
      }
      return orch;
    }
    const c1 = await ctx();
    const c4 = await ctx();
    const r1 = await build(1).run(c1);
    const r4 = await build(4).run(c4);
    expect(scrub(JSON.stringify(r1.findings))).toBe(
      scrub(JSON.stringify(r4.findings)),
    );
    expect(scrub(JSON.stringify(r1.aiConcerns))).toBe(
      scrub(JSON.stringify(r4.aiConcerns)),
    );
  });
});
