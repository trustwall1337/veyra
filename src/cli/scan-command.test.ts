import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CommanderError } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NotImplementedError,
  type ScanOrchestrator,
} from '../core/orchestrator/scan-orchestrator.js';
import type { AgentExecutionContext, AgentLogger } from '../types/agent.js';
import { isErr, isOk } from '../types/result.js';
import {
  defaultReadOnlyEvidencePolicy,
  type EnvironmentType,
  type ValidationPolicy,
} from '../types/validation-policy.js';

import { CliUsageError } from './errors.js';
import {
  APPROVED_PROD_SAFE_REJECTION_MESSAGE,
  SANDBOX_REJECTION_MESSAGE,
  buildScanCommand,
  runScan,
  type ScanCommandDeps,
  type ScanOptions,
  type StatLike,
} from './scan-command.js';

/** A minimal AgentLogger that records calls instead of writing to stderr. */
function recordingLogger(): AgentLogger & {
  records: { level: string; msg: string }[];
} {
  const records: { level: string; msg: string }[] = [];
  return {
    records,
    debug: (msg) => records.push({ level: 'debug', msg }),
    info: (msg) => records.push({ level: 'info', msg }),
    warn: (msg) => records.push({ level: 'warn', msg }),
    error: (msg) => records.push({ level: 'error', msg }),
  };
}

/**
 * Orchestrator double whose `run` is fully controllable per-test. Default:
 * reproduces the step-02 skeleton behavior (throws NotImplementedError).
 */
function fakeOrchestrator(
  behavior: 'not_implemented' | 'no_op' | 'throw_other' = 'not_implemented',
): ScanOrchestrator & { runCalls: AgentExecutionContext[] } {
  const runCalls: AgentExecutionContext[] = [];
  return {
    runCalls,
    register: () => undefined,
    run: async (ctx) => {
      runCalls.push(ctx);
      if (behavior === 'not_implemented') {
        throw new NotImplementedError('skeleton');
      }
      if (behavior === 'throw_other') {
        throw new Error('unexpected boom');
      }
    },
  };
}

function fakeStat(map: Record<string, 'dir' | 'file'>) {
  return async (p: string): Promise<StatLike> => {
    const kind = map[p];
    if (kind === undefined) {
      const e: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      e.code = 'ENOENT';
      throw e;
    }
    return {
      isDirectory: () => kind === 'dir',
      isFile: () => kind === 'file',
    };
  };
}

function makeDeps(overrides: Partial<ScanCommandDeps> = {}): ScanCommandDeps {
  const base: ScanCommandDeps = {
    stat: fakeStat({}),
    orchestratorFactory: () => fakeOrchestrator('not_implemented'),
    policyFactory: defaultReadOnlyEvidencePolicy,
    logger: recordingLogger(),
    now: () => new Date('2026-05-24T12:00:00.000Z'),
    random: () => 'abcd1234',
  };
  return { ...base, ...overrides };
}

function baseOptions(overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    project: '/proj',
    out: 'veyra-report.md',
    failOnBlocker: false,
    mode: 'read_only_evidence',
    env: 'local',
    lovableMcp: false,
    ai: true,
    ...overrides,
  };
}

describe('runScan — argv and validation', () => {
  it('rejects an invalid --project path', async () => {
    const deps = makeDeps({ stat: fakeStat({}) });
    const result = await runScan(baseOptions({ project: '/nope' }), deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(CliUsageError);
      expect(result.error.message).toContain('--project');
      expect(result.error.message).toContain('does not exist');
    }
  });

  it('rejects --project that is not a directory', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/file.txt': 'file' }),
    });
    const result = await runScan(baseOptions({ project: '/file.txt' }), deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('is not a directory');
    }
  });

  it('rejects --supabase-schema that does not exist', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ supabaseSchema: '/missing.sql' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--supabase-schema');
    }
  });

  it('rejects --supabase-schema that is a directory, not a file', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir', '/schema-dir': 'dir' }),
    });
    const result = await runScan(
      baseOptions({ supabaseSchema: '/schema-dir' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('is not a file');
    }
  });

  it('rejects --mode sandbox_active_validation with the Phase 2 message', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ mode: 'sandbox_active_validation' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe(SANDBOX_REJECTION_MESSAGE);
      expect(result.error.message).toContain('Phase 2 — not yet implemented');
      expect(result.error.message).toContain(
        'phases/phase-2/PHASE_2_PLAN.md',
      );
    }
  });

  it('rejects --mode approved_production_safe with the later-phase message', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ mode: 'approved_production_safe' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe(APPROVED_PROD_SAFE_REJECTION_MESSAGE);
      expect(result.error.message).toContain('not yet implemented');
      expect(result.error.message).toContain('FPP §17 Phase 5');
    }
  });

  it('rejects deferred modes BEFORE touching the filesystem', async () => {
    const stat = vi.fn<(p: string) => Promise<StatLike>>(
      async () => ({ isDirectory: () => true, isFile: () => false }),
    );
    const deps = makeDeps({ stat });
    const result = await runScan(
      baseOptions({ mode: 'sandbox_active_validation', project: '/anywhere' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    expect(stat).not.toHaveBeenCalled();
  });

  it('rejects an unknown --mode', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ mode: 'totally_bogus' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--mode');
    }
  });

  it('rejects an unknown --env', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ env: 'qa' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--env');
    }
  });

  it('rejects --lovable-mcp without --lovable-project', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ lovableMcp: true }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--lovable-mcp');
      expect(result.error.message).toContain('--lovable-project');
    }
  });

  it('accepts --lovable-mcp WITH --lovable-project', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({
        lovableMcp: true,
        lovableProject: 'proj-123',
      }),
      deps,
    );
    expect(isOk(result)).toBe(true);
  });

  it('accepts read_only_evidence in production env', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ mode: 'read_only_evidence', env: 'production' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.exitCode).toBe(0);
    }
  });
});

describe('runScan — orchestrator wiring', () => {
  it('builds a read_only_evidence ValidationPolicy from --env', async () => {
    const policyFactory = vi.fn<(env: EnvironmentType) => ValidationPolicy>(
      defaultReadOnlyEvidencePolicy,
    );
    const orch = fakeOrchestrator('not_implemented');
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      policyFactory,
      orchestratorFactory: () => orch,
    });

    const result = await runScan(
      baseOptions({ env: 'staging' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    expect(policyFactory).toHaveBeenCalledWith('staging');
    expect(orch.runCalls.length).toBe(1);
    const first = orch.runCalls[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.policy.mode).toBe('read_only_evidence');
      expect(first.policy.environment).toBe('staging');
    }
  });

  it('treats the step-02 orchestrator NotImplementedError as expected (exit 0)', async () => {
    const logger = recordingLogger();
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      orchestratorFactory: () => fakeOrchestrator('not_implemented'),
      logger,
    });

    const result = await runScan(baseOptions(), deps);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.exitCode).toBe(0);
    }
    const infoLogged = logger.records.find((r) => r.level === 'info');
    expect(infoLogged).toBeDefined();
    expect(infoLogged?.msg).toContain('orchestrator runs no agents yet');
  });

  it('re-throws unexpected orchestrator errors instead of swallowing them', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      orchestratorFactory: () => fakeOrchestrator('throw_other'),
    });
    await expect(runScan(baseOptions(), deps)).rejects.toThrow(
      /unexpected boom/,
    );
  });
});

describe('runScan — --fail-on-blocker exit code', () => {
  // Step 03 contract: --fail-on-blocker is wired but produces no behavior
  // change yet (readiness_status arrives in step 14). Both paths return 0.
  it('exits 0 when --fail-on-blocker is absent', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ failOnBlocker: false }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.exitCode).toBe(0);
    }
  });

  it('exits 0 when --fail-on-blocker is set but no readiness exists yet', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await runScan(
      baseOptions({ failOnBlocker: true }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.exitCode).toBe(0);
    }
  });
});

describe('buildScanCommand — commander surface', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-cli-'));
  });

  it('rejects when --project is missing (commander required option)', async () => {
    const cmd = buildScanCommand(makeDeps()).exitOverride();
    await expect(
      cmd.parseAsync([], { from: 'user' }),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it('parses a complete argv against a real temp directory', async () => {
    const orch = fakeOrchestrator('not_implemented');
    const deps = makeDeps({
      stat: (p) => fs.stat(p),
      orchestratorFactory: () => orch,
    });
    const cmd = buildScanCommand(deps).exitOverride();
    await cmd.parseAsync(
      ['--project', projectDir, '--out', path.join(projectDir, 'r.md')],
      { from: 'user' },
    );
    expect(orch.runCalls.length).toBe(1);
  });

  it('surfaces a deferred-mode rejection as a CliUsageError thrown out of parseAsync', async () => {
    const cmd = buildScanCommand(makeDeps()).exitOverride();
    await expect(
      cmd.parseAsync(
        ['--project', projectDir, '--mode', 'sandbox_active_validation'],
        { from: 'user' },
      ),
    ).rejects.toBeInstanceOf(CliUsageError);
  });

  it('does not import any AI provider SDK when --ai-provider is given (Phase 1 stub)', async () => {
    // The flag is accepted and stored on the parsed options; no provider code
    // exists in Phase 1, so we just assert the command exits cleanly.
    const orch = fakeOrchestrator('not_implemented');
    const deps = makeDeps({
      stat: (p) => fs.stat(p),
      orchestratorFactory: () => orch,
    });
    const cmd = buildScanCommand(deps).exitOverride();
    await cmd.parseAsync(
      ['--project', projectDir, '--ai-provider', 'openai'],
      { from: 'user' },
    );
    expect(orch.runCalls.length).toBe(1);
  });
});
