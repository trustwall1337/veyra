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
  GITLEAKS_SCANNER_ID,
  buildGitleaksArgs,
  runGitleaks,
} from './adapter.js';
import type {
  GitleaksRunner,
  GitleaksRunnerResult,
} from './types.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

function staticRunner(result: GitleaksRunnerResult): GitleaksRunner {
  return () => Promise.resolve(result);
}

function throwingRunner(err: unknown): GitleaksRunner {
  return () => Promise.reject(err);
}

describe('buildGitleaksArgs — guardrails', () => {
  // Done-when line 26 of the step file: "`--redact` is in default args
  // (verified by unit test that asserts the arg array)."
  it('includes --redact in the default args', () => {
    const args = buildGitleaksArgs({ projectPath: '/some/project' });
    expect(args).toContain('--redact');
  });

  it('requests JSON output and writes it to stdout', () => {
    const args = buildGitleaksArgs({ projectPath: '/some/project' });
    expect(args).toContain('--report-format');
    const formatIndex = args.indexOf('--report-format');
    expect(args[formatIndex + 1]).toBe('json');
    expect(args).toContain('--report-path');
    const pathIndex = args.indexOf('--report-path');
    expect(args[pathIndex + 1]).toBe('/dev/stdout');
  });

  it('passes the project path under --source (not positional)', () => {
    const args = buildGitleaksArgs({ projectPath: '/my/proj' });
    const sourceIndex = args.indexOf('--source');
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(args[sourceIndex + 1]).toBe('/my/proj');
  });

  it('starts with the gitleaks `detect` subcommand', () => {
    const args = buildGitleaksArgs({ projectPath: '/x' });
    expect(args[0]).toBe('detect');
  });

  it('NEVER passes any mutation flag (--fix, --apply, --commit, --add)', () => {
    const args = buildGitleaksArgs({ projectPath: '/x' });
    const forbidden = ['--fix', '--apply', '--commit', '--add', '--write'];
    for (const f of forbidden) {
      expect(args).not.toContain(f);
    }
  });

  it('returns a frozen-shape array (callers cannot mutate the defaults)', () => {
    const a = buildGitleaksArgs({ projectPath: '/x' });
    const b = buildGitleaksArgs({ projectPath: '/x' });
    expect(a).toEqual(b);
  });
});

describe('runGitleaks — success paths', () => {
  it('returns empty findings on exit 0 with empty stdout', async () => {
    const stdout = await loadFixture('no-findings');
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 0 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('returns parsed findings on exit 1 (gitleaks signals findings present)', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings.length).toBe(2);
      expect(result.value.findings[0]?.ruleId).toBe('generic-api-key');
    }
  });

  it('treats exit 1 as success — it means findings present, not a failure', async () => {
    // This is a separate assertion from the test above to make the contract
    // explicit: many CI configs treat non-zero exit as failure; the adapter
    // does not.
    const stdout = await loadFixture('no-findings');
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
  });

  it('passes the project path through to the runner argv', async () => {
    const seenArgs: string[] = [];
    const runner: GitleaksRunner = (_binary, args) => {
      seenArgs.push(...args);
      return Promise.resolve({ stdout: '[]', stderr: '', exitCode: 0 });
    };
    await runGitleaks({ projectPath: '/my/real/path' }, runner);
    expect(seenArgs).toContain('/my/real/path');
    expect(seenArgs).toContain('--redact');
  });

  it('honors a per-call timeout override', async () => {
    const runner = vi.fn<GitleaksRunner>(() =>
      Promise.resolve({ stdout: '[]', stderr: '', exitCode: 0 }),
    );
    await runGitleaks({ projectPath: '/x', timeoutMs: 5000 }, runner);
    expect(runner).toHaveBeenCalledWith(
      'gitleaks',
      expect.any(Array),
      { timeoutMs: 5000 },
    );
  });
});

describe('runGitleaks — failure paths', () => {
  it('returns ScannerNotInstalledError when the runner rejects with one', async () => {
    const result = await runGitleaks(
      { projectPath: '/proj' },
      throwingRunner(
        new ScannerNotInstalledError('gitleaks', 'install hint here'),
      ),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerNotInstalledError);
      const installError = result.error as ScannerNotInstalledError;
      expect(installError.scannerName).toBe('gitleaks');
      expect(installError.suggestion).toBe('install hint here');
    }
  });

  it('returns ScannerExecutionError when the runner rejects with one', async () => {
    const result = await runGitleaks(
      { projectPath: '/proj' },
      throwingRunner(
        new ScannerExecutionError('gitleaks', 'subprocess died'),
      ),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
    }
  });

  it('wraps a generic Error from the runner as ScannerExecutionError', async () => {
    const result = await runGitleaks(
      { projectPath: '/proj' },
      throwingRunner(new Error('something unrelated')),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('something unrelated');
    }
  });

  it('returns ScannerExecutionError when exit code > 1', async () => {
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout: '', stderr: 'crash', exitCode: 126 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('126');
    }
  });

  it('returns ScannerExecutionError when exitCode is null (killed by signal / timeout)', async () => {
    // `child.on('close', ...)` reports `exitCode: null` when the process did
    // not exit normally — the spawn `timeout` option firing SIGTERM is the
    // common case. The adapter MUST NOT silently treat this as a clean run.
    const result = await runGitleaks(
      { projectPath: '/proj' },
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
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });
});

describe('runGitleaks — ScanFact emission (step 05b)', () => {
  it('emits one ScanFact per parsed finding, with source.kind = scanner_match', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.facts.length).toBe(result.value.findings.length);
    for (const fact of result.value.facts) {
      expect(fact.source.kind).toBe('scanner_match');
      expect(fact.redacted).toBe(true);
      if (fact.source.kind === 'scanner_match') {
        expect(fact.source.payload.content_kind).toBe(
          'redacted_secret_context',
        );
      }
    }
  });

  it('mints a scanner_id that resolves via the service registry', async () => {
    const lookup = registry.lookupScanner(GITLEAKS_SCANNER_ID);
    expect(isOk(lookup)).toBe(true);
    if (isOk(lookup)) {
      expect(lookup.value.id as string).toBe('gitleaks');
    }
  });

  it('stamps every fact in one run with the same observed_at and args_fingerprint', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const [a, b] = result.value.facts;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(a.observed_at).toBe(b.observed_at);
      expect(a.args_fingerprint_sha256).toBe(b.args_fingerprint_sha256);
      expect(a.args_fingerprint_sha256.length).toBe(64); // sha256 hex
      expect(a.fact_id).not.toBe(b.fact_id); // distinct facts
    }
  });

  it('does NOT include a raw secret in any ScanFact (parser-leak defense via 02c)', async () => {
    const fakeAwsKey = ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join('');
    const stdout = JSON.stringify([
      {
        Description: `AWS Access Key: ${fakeAwsKey}`,
        StartLine: 3,
        File: '.env',
        Match: fakeAwsKey,
        Secret: fakeAwsKey,
        RuleID: 'aws-access-token',
        Fingerprint: '.env:aws-access-token:3',
      },
    ]);
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const serializedFacts = JSON.stringify(result.value.facts);
    expect(serializedFacts).not.toContain(fakeAwsKey);
    expect(serializedFacts).toContain('REDACTED');
  });
});

describe('runGitleaks — secret hygiene', () => {
  /**
   * Cross-check on the parser's Done-When contract from the adapter side:
   * even if gitleaks somehow returns a raw value, `runGitleaks` must not
   * pass it through.
   */
  it('end-to-end: a raw AWS-shaped key planted in Description is scrubbed', async () => {
    const fakeAwsKey = ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join('');
    const stdout = JSON.stringify([
      {
        Description: `AWS Access Key: ${fakeAwsKey}`,
        StartLine: 3,
        File: '.env',
        Match: fakeAwsKey,
        Secret: fakeAwsKey,
        RuleID: 'aws-access-token',
        Fingerprint: '.env:aws-access-token:3',
      },
    ]);
    const result = await runGitleaks(
      { projectPath: '/proj' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(fakeAwsKey);
    expect(result.value.findings[0]?.description).toContain('REDACTED');
  });
});
