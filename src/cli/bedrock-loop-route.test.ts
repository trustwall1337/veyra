import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAwsCredentials } from '../ai/bedrock/auth.js';
import {
  type AgenticLoopResult,
  type AiDriver,
} from '../core/orchestrator/agentic-loop.js';
import { ArtifactState } from '../core/orchestrator/artifact-state.js';
import { DEFAULT_BUDGET_CAPS } from '../core/orchestrator/loop-budget.js';
import { isErr, isOk } from '../types/result.js';
import { parseLoopCliOptions } from './loop-cli-options.js';

/**
 * Step 31d verification suite. Many assertions (V1, V2, V3, V8, V9, V10, V12,
 * V13) are already enforced by the existing tests for steps 31 / 31b / 31c /
 * 32 / 35 / 37; this file covers the step-31d-specific assertions: V5a (argv
 * guard), V6 (model_id pre-seed), V7 (SDK-chain auth), V14 (read-only path
 * still produces a budget snapshot — i.e. the new required field), V16
 * (`runScan` exercises `loopFactory` on Bedrock + Mode A, not the topo-sort
 * orchestrator).
 */

describe('Step 31d V5a — --aws-session-token rejected via parseLoopCliOptions', () => {
  it('rejects --aws-session-token on argv', () => {
    const r = parseLoopCliOptions({
      mode: 'mode_a',
      env: 'dev',
      rawArgv: ['--aws-session-token=FQoGZXIv...REDACTED'],
    });
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.message).toContain('--aws-session-token');
  });

  it('still rejects --aws-access-key-id and --aws-secret-access-key', () => {
    for (const flag of ['--aws-access-key-id', '--aws-secret-access-key']) {
      const r = parseLoopCliOptions({
        mode: 'mode_a',
        env: 'dev',
        rawArgv: [`${flag}=REDACTED`],
      });
      expect(isErr(r)).toBe(true);
    }
  });
});

describe('Step 31d V7 — auth accepts the SDK provider chain', () => {
  it('returns ok({resolved,region,source}) when the chain resolves', async () => {
    const r = await readAwsCredentials({
      env: (n) => (n === 'AWS_REGION' ? 'eu-west-1' : undefined),
      chainLoader: async () => ({ providerName: 'IniProvider' }),
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.region).toBe('eu-west-1');
    expect(r.value.source).toBe('profile');
    expect(r.value.resolved).toBe(true);
  });

  it('errs when AWS_REGION/AWS_DEFAULT_REGION are unset', async () => {
    const r = await readAwsCredentials({
      env: () => undefined,
      chainLoader: async () => ({ providerName: 'IniProvider' }),
    });
    expect(isErr(r)).toBe(true);
  });

  it('errs when the chain itself fails to resolve a credential', async () => {
    const r = await readAwsCredentials({
      env: (n) => (n === 'AWS_REGION' ? 'eu-west-1' : undefined),
      chainLoader: async () => {
        throw new Error('chain did not resolve');
      },
    });
    expect(isErr(r)).toBe(true);
  });
});

describe('Step 31d V6 — Bedrock loop driver pre-seeds model_id', () => {
  it('the driver_error trace row carries the pre-seeded model_id (no envelope)', async () => {
    // Driver throws on its FIRST call → loop enters the driver-error path
    // BEFORE any envelope arrives. Without the `requiredModelId` pre-seed
    // (Step 31d), the trace row would have `model_id: undefined`.
    const driver: AiDriver = {
      proposeNext: async () => {
        throw new Error('driver boom');
      },
    };
    const { createToolRegistry } = await import('../core/tools/registry.js');
    const { runAgenticLoop } = await import(
      '../core/orchestrator/agentic-loop.js'
    );
    const { defaultReadOnlyEvidencePolicy } = await import(
      '../types/validation-policy.js'
    );
    const artifactDir = await tmpDir();
    const result = await runAgenticLoop({
      registry: createToolRegistry(),
      aiDriver: driver,
      policy: defaultReadOnlyEvidencePolicy('dev'),
      context: { scanId: 's1', projectPath: '/tmp/x', artifactDir },
      artifactDir,
      requiredModelId: 'eu.anthropic.claude-sonnet-4-6',
    });
    expect(result.termination).toBe('driver_error');
    // Read the JSONL back; the driver_error row must carry the model_id.
    const raw = await fs.readFile(
      path.join(artifactDir, 'loop-trace.jsonl'),
      'utf8',
    );
    const rows = raw
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as { proposal_kind?: string; model_id?: string },
      );
    const driverErrorRow = rows.find(
      (r) => r.proposal_kind === 'driver_error',
    );
    expect(driverErrorRow).toBeDefined();
    expect(driverErrorRow?.model_id).toBe('eu.anthropic.claude-sonnet-4-6');
  });
});

describe('Step 31d — recorded fixture loads + every proposal validates', () => {
  it('the synthetic recording parses and each proposal passes aiProposalSchema (§6.5-r1 SHOULD #4)', async () => {
    const fixturePath = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      'vulnerable-lovable-supabase',
      'recordings',
      'bedrock-loop-mode-a.json',
    );
    const raw = await fs.readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      _synthetic?: boolean;
      recordings: ReadonlyArray<{ proposal: unknown }>;
    };
    // Step 31d codex §6.5-r2 MUST #2: the test asserts STRUCTURAL properties
    // — recordings present, every proposal validates against the schema. The
    // earlier `expect(parsed._synthetic).toBe(true)` was REMOVED because it
    // locked in placeholder state and violated the "recorded-from-real OR
    // env-gated-live, never mock-only" guardrail. The `_synthetic` field, if
    // present, is informational only and remains until a real Bedrock capture
    // replaces this fixture.
    expect(parsed.recordings.length).toBeGreaterThan(0);
    const { aiProposalSchema } = await import(
      '../core/orchestrator/agentic-loop.js'
    );
    for (const recording of parsed.recordings) {
      const validated = aiProposalSchema.safeParse(recording.proposal);
      expect(validated.success).toBe(true);
    }
  });
});

describe('Step 31d V14 — AgenticLoopResult.budget_snapshot is required', () => {
  it('compile-time + structural: every AgenticLoopResult carries budget_snapshot', () => {
    // Compile-time: the type forces the field. We synthesise a minimal valid
    // value to prove the shape.
    const result: AgenticLoopResult = {
      termination: 'done',
      findings: [],
      facts: [],
      ledgerMissing: [],
      // ArtifactState is constructed lazily; we use a casted minimal stand-in.
      state: new ArtifactState({ artifactDir: '/tmp/x' }),
      budget_snapshot: {
        tool_calls: 0,
        steps: 0,
        cost_units: 0,
        elapsed_ms: 0,
        caps: DEFAULT_BUDGET_CAPS,
      },
    };
    expect(result.budget_snapshot.caps).toBe(DEFAULT_BUDGET_CAPS);
  });
});

describe('Step 31d V16 — runScan exercises loopFactory on bedrock+Mode A', () => {
  it('a fake loopFactory is invoked; the topo orchestratorFactory is NOT (on this route)', async () => {
    // This integration test imports runScan + builds deps with spy factories.
    // The spy loopFactory records its invocation; the orchestratorFactory
    // returns a stub that throws if called — proving the new branch routed
    // away from it. We import lazily to keep the suite fast.
    const mod = await import('./scan-command.js');
    const orchestratorThrown = { value: false };
    let loopFactoryCalled = false;
    const fakeOrchestrator = {
      register: () => {
        orchestratorThrown.value = true;
        throw new Error('orchestrator should not be reached on bedrock+Mode A');
      },
      run: async () => {
        orchestratorThrown.value = true;
        throw new Error('orchestrator should not be reached on bedrock+Mode A');
      },
    } as unknown as ReturnType<
      typeof mod.defaultScanCommandDeps
    >['orchestratorFactory'] extends () => infer R
      ? R
      : never;
    const dir = await tmpDir();
    const projectRoot = path.join(dir, 'fixture');
    await fs.mkdir(projectRoot, { recursive: true });
    const deps: Parameters<typeof mod.runScan>[1] = {
      ...mod.defaultScanCommandDeps(),
      stat: async (p) => {
        try {
          const s = await fs.stat(p);
          return { isDirectory: () => s.isDirectory(), isFile: () => s.isFile() };
        } catch {
          return { isDirectory: () => false, isFile: () => false };
        }
      },
      envReader: (n) =>
        n === 'AWS_REGION' ? 'us-east-1' : n === 'AWS_ACCESS_KEY_ID' ? 'AKIA' : undefined,
      orchestratorFactory: () => fakeOrchestrator,
      loopFactory: async () =>
        ({
          termination: 'done',
          findings: [],
          facts: [],
          ledgerMissing: [],
          state: new ArtifactState({ artifactDir: '/tmp/x' }),
          budget_snapshot: {
            tool_calls: 0,
            steps: 0,
            cost_units: 0,
            elapsed_ms: 0,
            caps: DEFAULT_BUDGET_CAPS,
          },
        }) as AgenticLoopResult,
    };
    // The deps above set `loopFactory` to a spy via closure capture.
    const realLoop = deps.loopFactory!;
    const spyLoop: typeof realLoop = async (args) => {
      loopFactoryCalled = true;
      return realLoop(args);
    };
    const result = await mod.runScan(
      {
        project: projectRoot,
        out: path.join(dir, 'out.md'),
        failOnBlocker: false,
        mode: 'read_only_evidence',
        env: 'dev',
        lovableMcp: false,
        ai: true,
        aiProvider: 'bedrock',
      },
      { ...deps, loopFactory: spyLoop },
    );
    expect(isOk(result)).toBe(true);
    expect(loopFactoryCalled).toBe(true);
    expect(orchestratorThrown.value).toBe(false);
  });
});

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veyra-31d-'));
}
