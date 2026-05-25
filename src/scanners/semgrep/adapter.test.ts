import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { registry } from '../../core/registry/service-registry.js';
import {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';

import {
  SEMGREP_SCANNER_ID,
  buildSemgrepArgs,
  runSemgrep,
} from './adapter.js';
import type {
  SemgrepRunner,
  SemgrepRunnerResult,
} from './types.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

function staticRunner(result: SemgrepRunnerResult): SemgrepRunner {
  return () => Promise.resolve(result);
}

function throwingRunner(err: unknown): SemgrepRunner {
  return () => Promise.reject(err);
}

describe('buildSemgrepArgs — guardrails', () => {
  it('uses --json so the adapter parses JSON, not human output', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj',
      rulesPath: '/repo/rules',
    });
    expect(args).toContain('--json');
  });

  it('passes the rules path under --config (never --config auto or a registry bundle)', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj',
      rulesPath: '/repo/rules',
    });
    const idx = args.indexOf('--config');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('/repo/rules');
    expect(args).not.toContain('auto');
    for (const a of args) {
      expect(a.startsWith('p/')).toBe(false);
    }
  });

  it('uses --no-rewrite-rule-ids so check_id stays as written in YAML', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj',
      rulesPath: '/repo/rules',
    });
    expect(args).toContain('--no-rewrite-rule-ids');
  });

  it('disables telemetry with --metrics=off', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj',
      rulesPath: '/repo/rules',
    });
    expect(args).toContain('--metrics=off');
  });

  it('passes the project path as a positional argument', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj/path',
      rulesPath: '/repo/rules',
    });
    expect(args).toContain('/proj/path');
  });

  // Step 07 Guardrails (lines 39-40): no LLM workflows, no autofix, no pro.
  it('NEVER passes --autofix, --pro, --ci, or any mutation flag', () => {
    const args = buildSemgrepArgs({
      projectPath: '/proj',
      rulesPath: '/repo/rules',
    });
    const forbidden = [
      '--autofix',
      '--pro',
      '--write',
      'ci',
      '--config=auto',
      '--enable-experimental',
    ];
    for (const f of forbidden) {
      expect(args).not.toContain(f);
    }
  });
});

describe('runSemgrep — success paths', () => {
  it('returns empty findings on exit 0 with the no-findings fixture', async () => {
    const stdout = await loadFixture('no-findings');
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({ stdout, stderr: '', exitCode: 0 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('parses with-findings fixture on exit 1', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings.length).toBe(2);
      expect(result.value.findings[0]?.ruleId).toBe(
        'direct-object-access-by-id',
      );
    }
  });

  it('treats exit 1 (findings present) as a successful run', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({
        stdout: '{"results": []}',
        stderr: '',
        exitCode: 1,
      }),
    );
    expect(isOk(result)).toBe(true);
  });

  it('passes both paths through to the runner argv', async () => {
    const seenArgs: string[] = [];
    const runner: SemgrepRunner = (_binary, args) => {
      seenArgs.push(...args);
      return Promise.resolve({
        stdout: '{"results": []}',
        stderr: '',
        exitCode: 0,
      });
    };
    await runSemgrep(
      { projectPath: '/my/proj', rulesPath: '/my/rules' },
      runner,
    );
    expect(seenArgs).toContain('/my/proj');
    expect(seenArgs).toContain('/my/rules');
  });

  it('honors a per-call timeout override', async () => {
    const runner = vi.fn<SemgrepRunner>(() =>
      Promise.resolve({
        stdout: '{"results": []}',
        stderr: '',
        exitCode: 0,
      }),
    );
    await runSemgrep(
      { projectPath: '/x', rulesPath: '/r', timeoutMs: 30_000 },
      runner,
    );
    expect(runner).toHaveBeenCalledWith(
      'semgrep',
      expect.any(Array),
      { timeoutMs: 30_000 },
    );
  });
});

describe('runSemgrep — failure paths', () => {
  it('returns ScannerNotInstalledError when the runner rejects with one', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      throwingRunner(
        new ScannerNotInstalledError('semgrep', 'install hint here'),
      ),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerNotInstalledError);
    }
  });

  it('returns ScannerExecutionError when the runner rejects with one', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      throwingRunner(new ScannerExecutionError('semgrep', 'died')),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
    }
  });

  it('wraps a generic Error from the runner as ScannerExecutionError', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      throwingRunner(new Error('something unrelated')),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('something unrelated');
    }
  });

  it('returns ScannerExecutionError when exit code > 1', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({ stdout: '', stderr: 'panic', exitCode: 2 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('2');
    }
  });

  it('returns ScannerExecutionError when exitCode is null (killed by signal / timeout)', async () => {
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({ stdout: '', stderr: '', exitCode: null }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('did not exit normally');
    }
  });

  it('returns ScannerOutputParseError on malformed stdout', async () => {
    const stdout = await loadFixture('malformed');
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/r' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });
});

describe('runSemgrep — ScanFact emission (step 07b)', () => {
  it('emits one ScanFact per parsed finding with payload.rule_id', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/rules' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.facts.length).toBe(result.value.findings.length);
    for (let i = 0; i < result.value.facts.length; i += 1) {
      const fact = result.value.facts[i];
      const finding = result.value.findings[i];
      expect(fact).toBeDefined();
      expect(finding).toBeDefined();
      if (fact === undefined || finding === undefined) continue;
      expect(fact.source.kind).toBe('scanner_match');
      if (fact.source.kind === 'scanner_match') {
        expect(fact.source.payload.rule_id).toBe(finding.ruleId);
        expect(fact.source.payload.content_kind).toBe('text');
      }
    }
  });

  it('mints a scanner_id that resolves via the service registry', () => {
    const lookup = registry.lookupScanner(SEMGREP_SCANNER_ID);
    expect(isOk(lookup)).toBe(true);
    if (isOk(lookup)) {
      expect(lookup.value.id as string).toBe('semgrep');
    }
  });

  it('populates byte_range from semgrep start.offset / end.offset when present', async () => {
    const stdout = JSON.stringify({
      results: [
        {
          check_id: 'rules.authz.direct-object-access-by-id',
          path: 'src/pages/OrderPage.tsx',
          start: { line: 12, offset: 240 },
          end: { line: 18, offset: 480 },
          extra: { message: 'order_id read from query', severity: 'WARNING' },
        },
      ],
      errors: [],
    });
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/rules' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const fact = result.value.facts[0];
    expect(fact).toBeDefined();
    if (fact !== undefined && fact.source.kind === 'scanner_match') {
      expect(fact.source.payload.byte_range).toEqual({ start: 240, end: 480 });
    }
  });

  it('runs the captured `extra.lines` through 02c sanitization and sets redacted accordingly', async () => {
    const fakeAwsKey = ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join('');
    const stdout = JSON.stringify({
      results: [
        {
          check_id: 'rules.secrets.aws-key-in-source',
          path: 'src/lib/secrets.ts',
          start: { line: 1, offset: 0 },
          end: { line: 1, offset: 30 },
          extra: {
            message: 'AWS key in source',
            severity: 'ERROR',
            lines: `const key = "${fakeAwsKey}";`,
          },
        },
      ],
      errors: [],
    });
    const result = await runSemgrep(
      { projectPath: '/proj', rulesPath: '/rules' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const fact = result.value.facts[0];
    expect(fact).toBeDefined();
    if (fact !== undefined && fact.source.kind === 'scanner_match') {
      expect(fact.source.payload.sanitized_excerpt).not.toContain(fakeAwsKey);
      expect(fact.source.payload.sanitized_excerpt).toContain('REDACTED');
      expect(fact.redacted).toBe(true);
    }
  });
});
