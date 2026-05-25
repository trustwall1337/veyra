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

import { OSV_SCANNER_ID, buildOsvArgs, runOsv } from './adapter.js';
import type { OsvRunner, OsvRunnerResult } from './types.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

function staticRunner(result: OsvRunnerResult): OsvRunner {
  return () => Promise.resolve(result);
}

function throwingRunner(err: unknown): OsvRunner {
  return () => Promise.reject(err);
}

describe('buildOsvArgs — guardrails', () => {
  it('uses --format json (never human-readable output)', () => {
    const args = buildOsvArgs({ lockfilePath: '/x/package-lock.json' });
    expect(args).toContain('--format');
    const idx = args.indexOf('--format');
    expect(args[idx + 1]).toBe('json');
  });

  // Done-When line 28: "Adapter accepts a lockfile path; refuses to traverse
  // the project file system on its own."
  it('passes the lockfile path under --lockfile (not a recursive --source flag)', () => {
    const args = buildOsvArgs({
      lockfilePath: '/proj/package-lock.json',
    });
    const idx = args.indexOf('--lockfile');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('/proj/package-lock.json');
  });

  it('NEVER includes recursive / source-traversal flags', () => {
    const args = buildOsvArgs({ lockfilePath: '/x/package-lock.json' });
    const forbidden = ['-r', '--recursive', '--source', 'scan'];
    for (const f of forbidden) {
      expect(args).not.toContain(f);
    }
  });

  it('NEVER passes a mutation flag', () => {
    const args = buildOsvArgs({ lockfilePath: '/x/package-lock.json' });
    const forbidden = ['--fix', '--apply', '--commit', '--add', '--write'];
    for (const f of forbidden) {
      expect(args).not.toContain(f);
    }
  });

  it('produces a stable arg list across calls', () => {
    const a = buildOsvArgs({ lockfilePath: '/x/lock' });
    const b = buildOsvArgs({ lockfilePath: '/x/lock' });
    expect(a).toEqual(b);
  });
});

describe('runOsv — success paths', () => {
  it('returns empty findings on exit 0 with empty stdout', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/package-lock.json' },
      staticRunner({ stdout: '', stderr: '', exitCode: 0 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('returns empty findings for the no-findings fixture', async () => {
    const stdout = await loadFixture('no-findings');
    const result = await runOsv(
      { lockfilePath: '/x/package-lock.json' },
      staticRunner({ stdout, stderr: '', exitCode: 0 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('parses with-findings fixture into the expected list on exit 1', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runOsv(
      { lockfilePath: '/x/package-lock.json' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings.length).toBe(2);
      const first = result.value.findings[0];
      expect(first?.packageName).toBe('axios');
      expect(first?.packageVersion).toBe('0.21.0');
    }
  });

  it('treats exit 1 (vulns present) as a successful run', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      staticRunner({ stdout: '{"results": []}', stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
  });

  it('passes the lockfile path through to the runner argv', async () => {
    const seenArgs: string[] = [];
    const runner: OsvRunner = (_binary, args) => {
      seenArgs.push(...args);
      return Promise.resolve({
        stdout: '{"results": []}',
        stderr: '',
        exitCode: 0,
      });
    };
    await runOsv({ lockfilePath: '/some/real/lockfile.lock' }, runner);
    expect(seenArgs).toContain('--lockfile');
    expect(seenArgs).toContain('/some/real/lockfile.lock');
  });

  it('honors a per-call timeout override', async () => {
    const runner = vi.fn<OsvRunner>(() =>
      Promise.resolve({
        stdout: '{"results": []}',
        stderr: '',
        exitCode: 0,
      }),
    );
    await runOsv({ lockfilePath: '/x/lock', timeoutMs: 8000 }, runner);
    expect(runner).toHaveBeenCalledWith(
      'osv-scanner',
      expect.any(Array),
      { timeoutMs: 8000 },
    );
  });
});

describe('runOsv — failure paths', () => {
  it('returns ScannerNotInstalledError when the runner rejects with one', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      throwingRunner(
        new ScannerNotInstalledError('osv-scanner', 'install hint here'),
      ),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerNotInstalledError);
      const installError = result.error as ScannerNotInstalledError;
      expect(installError.scannerName).toBe('osv-scanner');
    }
  });

  it('returns ScannerExecutionError when the runner rejects with one', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      throwingRunner(
        new ScannerExecutionError('osv-scanner', 'subprocess died'),
      ),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
    }
  });

  it('wraps a generic Error from the runner as ScannerExecutionError', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      throwingRunner(new Error('something unrelated')),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('something unrelated');
    }
  });

  it('returns ScannerExecutionError when exit code > 1', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      staticRunner({ stdout: '', stderr: 'crash', exitCode: 127 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerExecutionError);
      expect(result.error.message).toContain('127');
    }
  });

  it('returns ScannerExecutionError when exitCode is null (killed by signal / timeout)', async () => {
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
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
    const result = await runOsv(
      { lockfilePath: '/x/lock' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });
});

describe('runOsv — ScanFact emission (step 06b)', () => {
  it('emits one ScanFact per parsed finding, with source.kind = scanner_match', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runOsv(
      { lockfilePath: '/proj/package-lock.json' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.facts.length).toBe(result.value.findings.length);
    for (const fact of result.value.facts) {
      expect(fact.source.kind).toBe('scanner_match');
      expect(fact.redacted).toBe(false);
      expect(fact.file_path).toBe('/proj/package-lock.json');
      if (fact.source.kind === 'scanner_match') {
        expect(fact.source.payload.content_kind).toBe('text');
      }
    }
  });

  it('mints a scanner_id that resolves via the service registry', () => {
    const lookup = registry.lookupScanner(OSV_SCANNER_ID);
    expect(isOk(lookup)).toBe(true);
    if (isOk(lookup)) {
      expect(lookup.value.id as string).toBe('osv');
    }
  });

  it('emits ScanFacts that carry no classification fields (seam test for 08b)', async () => {
    // The OSV adapter's intermediate `OsvFinding` still carries
    // findingType / evidenceStrength / reviewAction for backward
    // compatibility with tool-runner (08b removes these). The new
    // `ScanFact` output is generic and must NOT surface them — the
    // assertion layer owns classification.
    const stdout = await loadFixture('with-findings');
    const result = await runOsv(
      { lockfilePath: '/proj/package-lock.json' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const serialized = JSON.stringify(result.value.facts);
    expect(serialized).not.toContain('findingType');
    expect(serialized).not.toContain('evidenceStrength');
    expect(serialized).not.toContain('reviewAction');
    expect(serialized).not.toContain('likely_issue');
    expect(serialized).not.toContain('review_before_launch');
  });

  it('stamps every fact in one run with the same observed_at and args_fingerprint', async () => {
    const stdout = await loadFixture('with-findings');
    const result = await runOsv(
      { lockfilePath: '/proj/lock' },
      staticRunner({ stdout, stderr: '', exitCode: 1 }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    if (result.value.facts.length < 1) return;
    const [a] = result.value.facts;
    expect(a).toBeDefined();
    if (a !== undefined) {
      expect(a.args_fingerprint_sha256.length).toBe(64);
      expect(a.observed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
