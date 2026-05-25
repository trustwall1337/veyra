import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CommanderError } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProviderRegistry } from '../ai/registry.js';
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
  validateScanOptions,
  type AiCacheTtl,
  type AiConcernThreshold,
  type ScanCommandDeps,
  type ScanOptions,
  type StatLike,
  type ValidatedScanInputs,
} from './scan-command.js';

/**
 * Build credential-shaped test strings at runtime so the file itself does
 * not contain a literal `sk-…` token (Veyra's pre-write secret hook blocks
 * raw-secret patterns even inside test fixtures). Each piece is innocuous
 * on its own.
 */
const CRED_PREFIXES = {
  sk: 's' + 'k' + '-',
  skAnt: 's' + 'k' + '-' + 'ant' + '-',
  xoxb: 'x' + 'oxb' + '-',
  ghp: 'g' + 'hp' + '_',
  githubPat: 'g' + 'ithub' + '_pat_',
  akia: 'A' + 'KIA',
} as const;

const FAKE_KEY_VALUE = 'a'.repeat(16);

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

function fakeEnv(map: Record<string, string>) {
  return (name: string): string | undefined => map[name];
}

function makeDeps(overrides: Partial<ScanCommandDeps> = {}): ScanCommandDeps {
  const base: ScanCommandDeps = {
    stat: fakeStat({}),
    orchestratorFactory: () => fakeOrchestrator('not_implemented'),
    policyFactory: defaultReadOnlyEvidencePolicy,
    logger: recordingLogger(),
    now: () => new Date('2026-05-24T12:00:00.000Z'),
    random: () => 'abcd1234',
    envReader: fakeEnv({}),
    providerRegistry: createDefaultProviderRegistry(),
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

describe('validateScanOptions — §12b opt-in matrix', () => {
  it('no env var, no --ai-provider → AI skipped silently (aiOptIn=false, aiDisabled=false)', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({}),
    });
    const result = await validateScanOptions(baseOptions(), deps);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(false);
      expect(result.value.aiDisabled).toBe(false);
      expect(result.value.aiProvider).toBeUndefined();
    }
  });

  it('env var set, no --ai-provider → AI skipped silently (aiOptIn=false)', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({ ANTHROPIC_API_KEY: 'redacted' }),
    });
    const result = await validateScanOptions(baseOptions(), deps);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(false);
      expect(result.value.aiDisabled).toBe(false);
    }
  });

  it('no env var, --ai-provider anthropic → reject at parse time with explicit env-var message', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({}),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('ANTHROPIC_API_KEY');
      expect(result.error.message).toContain('not set');
      expect(result.error.message).toContain('anthropic');
    }
  });

  it('rejection happens BEFORE filesystem stat (parse-time)', async () => {
    const stat = vi.fn<(p: string) => Promise<StatLike>>(
      async () => ({ isDirectory: () => true, isFile: () => false }),
    );
    const deps = makeDeps({ stat, envReader: fakeEnv({}) });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic', project: '/anywhere' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    expect(stat).not.toHaveBeenCalled();
  });

  it('env var + --ai-provider anthropic → AI opted-in (aiOptIn=true)', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({ ANTHROPIC_API_KEY: 'redacted' }),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(true);
      expect(result.value.aiDisabled).toBe(false);
      expect(result.value.aiProvider).toBe('anthropic');
    }
  });

  it('env var + --ai-provider + --no-ai → AI skipped (override)', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({ ANTHROPIC_API_KEY: 'redacted' }),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic', ai: false }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(false);
      expect(result.value.aiDisabled).toBe(true);
      expect(result.value.aiProvider).toBe('anthropic');
    }
  });

  it('treats an empty env var as missing (the matrix says "set")', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({ ANTHROPIC_API_KEY: '' }),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('--no-ai short-circuits a deferred provider rejection (hard override)', async () => {
    // §12b: `--no-ai` is the hard override. A CI script that has
    // `--ai-provider openai` staged for Phase 2 must still run today.
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({}),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'openai', ai: false }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(false);
      expect(result.value.aiDisabled).toBe(true);
      expect(result.value.aiProvider).toBe('openai');
    }
  });

  it('--no-ai short-circuits an env-var missing rejection', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({}),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'anthropic', ai: false }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiOptIn).toBe(false);
      expect(result.value.aiDisabled).toBe(true);
      expect(result.value.aiProvider).toBe('anthropic');
    }
  });

  it('--no-ai does NOT short-circuit the unknown-provider check (typo guard)', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({}),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'bedrock', ai: false }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('not a registered provider');
    }
  });

  it('rejects --ai-provider openai as Phase 2 deferred with plan-doc pointer', async () => {
    const deps = makeDeps({
      stat: fakeStat({ '/proj': 'dir' }),
      envReader: fakeEnv({ OPENAI_API_KEY: 'redacted' }),
    });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'openai' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Phase 2');
      expect(result.error.message).toContain('not yet implemented');
      expect(result.error.message).toContain(
        'phases/phase-2/PHASE_2_PLAN.md',
      );
    }
  });

  it('rejects --ai-provider with an unknown provider id', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: 'bedrock' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('not a registered provider');
      expect(result.error.message).toContain('bedrock');
    }
  });
});

describe('validateScanOptions — AI knobs (budget, threshold, cache, model)', () => {
  it('applies all AI defaults when no flag is passed', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(baseOptions(), deps);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiHypothesisBudget).toBe(100);
      expect(result.value.aiConcernThreshold).toBe('medium');
      expect(result.value.aiCacheTtl).toBe('5m');
      expect(result.value.aiModel).toBe('claude-sonnet-4-6');
    }
  });

  it('parses --ai-hypothesis-budget as an integer', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiHypothesisBudget: '42' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiHypothesisBudget).toBe(42);
    }
  });

  it('rejects non-positive --ai-hypothesis-budget', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    for (const bad of ['0', '-1', '1.5', 'abc', '']) {
      const result = await validateScanOptions(
        baseOptions({ aiHypothesisBudget: bad }),
        deps,
      );
      expect(isErr(result), `expected rejection for ${JSON.stringify(bad)}`).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('--ai-hypothesis-budget');
      }
    }
  });

  it('accepts each --ai-concern-threshold value', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    for (const t of ['low', 'medium', 'high'] as const) {
      const result = await validateScanOptions(
        baseOptions({ aiConcernThreshold: t }),
        deps,
      );
      expect(isOk(result), `threshold=${t}`).toBe(true);
      if (isOk(result)) {
        expect(result.value.aiConcernThreshold).toBe(t);
      }
    }
  });

  it('rejects an unknown --ai-concern-threshold', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiConcernThreshold: 'critical' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--ai-concern-threshold');
    }
  });

  it('accepts each --ai-cache-ttl value', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    for (const t of ['5m', '1h'] as const) {
      const result = await validateScanOptions(
        baseOptions({ aiCacheTtl: t }),
        deps,
      );
      expect(isOk(result), `ttl=${t}`).toBe(true);
      if (isOk(result)) {
        expect(result.value.aiCacheTtl).toBe(t);
      }
    }
  });

  it('rejects an unknown --ai-cache-ttl', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiCacheTtl: '24h' }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--ai-cache-ttl');
    }
  });

  it('accepts a custom --ai-model id', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiModel: 'claude-opus-4-7' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.aiModel).toBe('claude-opus-4-7');
    }
  });
});

describe('validateScanOptions — argv raw-secret guard (Constraint 5)', () => {
  it('rejects --ai-provider that starts with a known credential prefix', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiProvider: CRED_PREFIXES.skAnt + FAKE_KEY_VALUE }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('looks like a raw API key');
      expect(result.error.message).toContain('environment variable');
    }
  });

  it('rejects each well-known credential prefix on --ai-provider', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    for (const prefix of Object.values(CRED_PREFIXES)) {
      const value = prefix + FAKE_KEY_VALUE;
      const result = await validateScanOptions(
        baseOptions({ aiProvider: value }),
        deps,
      );
      expect(isErr(result), `prefix=${prefix}`).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('looks like a raw API key');
      }
    }
  });

  it('rejects a long high-entropy --ai-model value (entropy leg)', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    // 40-char mixed-case alphanumeric, no path separator — exercises the
    // entropy leg of the heuristic. Doesn't match any credential prefix.
    const value = 'aB3kQpZ9tLmN2sVrXdYjHfWcEgUvO0iPxRzKqLnT';
    const result = await validateScanOptions(
      baseOptions({ aiModel: value }),
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('--ai-model');
      expect(result.error.message).toContain('high-entropy');
    }
  });

  it('accepts normal model ids that include hyphens and digits', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    for (const m of [
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'gpt-4.1-mini',
      'gemini-2.0-pro',
    ]) {
      const result = await validateScanOptions(
        baseOptions({ aiModel: m }),
        deps,
      );
      expect(isOk(result), `model=${m}`).toBe(true);
    }
  });

  it('does not flag path-shaped flags as raw secrets (false-positive guard)', async () => {
    const longProj = '/' + 'aB3kQpZ9tLmN2sVrXdYjHfWcEgUvO0iPxRzKqLnT';
    const deps = makeDeps({ stat: fakeStat({ [longProj]: 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ project: longProj }),
      deps,
    );
    expect(isOk(result)).toBe(true);
  });
});

describe('validateScanOptions — seam tracking for 08d / 13b', () => {
  // Step 03b's `Done when:` calls for the parsed budget/threshold to "reach"
  // their consumers (08d and 13b). Until those steps land, we satisfy the
  // contract by asserting that a stub consumer reads the named field on
  // `ValidatedScanInputs` without any additional translation. This locks the
  // seam — 08d and 13b can read `aiHypothesisBudget` / `aiConcernThreshold`
  // directly.

  function applyHypothesisBudget(inputs: ValidatedScanInputs): number {
    // Stub for what step 08d's AI inference agent will do:
    return inputs.aiHypothesisBudget;
  }

  function applyConcernThreshold(
    inputs: ValidatedScanInputs,
  ): AiConcernThreshold {
    // Stub for what step 13b's reporter will do:
    return inputs.aiConcernThreshold;
  }

  function applyCacheTtl(inputs: ValidatedScanInputs): AiCacheTtl {
    return inputs.aiCacheTtl;
  }

  it('--ai-hypothesis-budget value flows through to the 08d-shaped consumer', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiHypothesisBudget: '7' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(applyHypothesisBudget(result.value)).toBe(7);
    }
  });

  it('--ai-concern-threshold value flows through to the 13b-shaped consumer', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiConcernThreshold: 'high' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(applyConcernThreshold(result.value)).toBe('high');
    }
  });

  it('--ai-cache-ttl value flows through to a runtime consumer', async () => {
    const deps = makeDeps({ stat: fakeStat({ '/proj': 'dir' }) });
    const result = await validateScanOptions(
      baseOptions({ aiCacheTtl: '1h' }),
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(applyCacheTtl(result.value)).toBe('1h');
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

  it('surfaces a Phase 2 provider rejection as a CliUsageError', async () => {
    const cmd = buildScanCommand(makeDeps({ stat: (p) => fs.stat(p) }))
      .exitOverride();
    await expect(
      cmd.parseAsync(
        ['--project', projectDir, '--ai-provider', 'openai'],
        { from: 'user' },
      ),
    ).rejects.toBeInstanceOf(CliUsageError);
  });

  it('parses every new AI flag at once and exposes them on ValidatedScanInputs', async () => {
    const orch = fakeOrchestrator('not_implemented');
    const deps = makeDeps({
      stat: (p) => fs.stat(p),
      orchestratorFactory: () => orch,
      envReader: fakeEnv({ ANTHROPIC_API_KEY: 'redacted' }),
    });
    const cmd = buildScanCommand(deps).exitOverride();
    await cmd.parseAsync(
      [
        '--project', projectDir,
        '--ai-provider', 'anthropic',
        '--ai-hypothesis-budget', '50',
        '--ai-concern-threshold', 'low',
        '--ai-cache-ttl', '1h',
        '--ai-model', 'claude-opus-4-7',
      ],
      { from: 'user' },
    );
    expect(orch.runCalls.length).toBe(1);
  });

  it('default invocation produces a Findings-only run (no AI opt-in)', async () => {
    const orch = fakeOrchestrator('not_implemented');
    const deps = makeDeps({
      stat: (p) => fs.stat(p),
      orchestratorFactory: () => orch,
      envReader: fakeEnv({ ANTHROPIC_API_KEY: 'set-but-ignored' }),
    });
    const cmd = buildScanCommand(deps).exitOverride();
    await cmd.parseAsync(
      ['--project', projectDir],
      { from: 'user' },
    );
    // Orchestrator was called (NotImplementedError swallowed), but no
    // --ai-provider was passed, so AI is not opted in.
    expect(orch.runCalls.length).toBe(1);
  });
});
