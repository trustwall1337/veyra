import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ScannerOutputParseError } from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';

import { parseSemgrepJson } from './parser.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

describe('parseSemgrepJson — well-formed inputs', () => {
  it('returns empty findings for the no-findings fixture', async () => {
    const stdout = await loadFixture('no-findings');
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
      expect(result.value.nonFatalErrors).toEqual([]);
    }
  });

  it('returns empty findings for empty stdout', () => {
    const result = parseSemgrepJson('');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('returns empty findings when results key is missing', () => {
    const result = parseSemgrepJson('{"version": "1.0.0"}');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings).toEqual([]);
    }
  });

  it('parses with-findings fixture into normalized findings', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings.length).toBe(2);

      const first = result.value.findings[0];
      expect(first?.ruleId).toBe('direct-object-access-by-id');
      expect(first?.filePath).toContain('OrderPage.tsx');
      expect(first?.startLine).toBe(12);
      expect(first?.endLine).toBe(18);
      expect(first?.severity).toBe('WARNING');
      expect(first?.message).toContain('cc-11-3');

      const second = result.value.findings[1];
      expect(second?.severity).toBe('ERROR');
      expect(second?.ruleId).toBe('service-role-on-client');
    }
  });
});

describe('parseSemgrepJson — severity normalization', () => {
  it('coerces an unknown severity to INFO', () => {
    const stdout = JSON.stringify({
      results: [
        {
          check_id: 'r1',
          path: 'f.ts',
          start: { line: 1 },
          end: { line: 1 },
          extra: { message: 'm', severity: 'CRITICAL' },
        },
      ],
    });
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings[0]?.severity).toBe('INFO');
    }
  });

  it('accepts lowercase severity and normalises it', () => {
    const stdout = JSON.stringify({
      results: [
        {
          check_id: 'r1',
          path: 'f.ts',
          start: { line: 1 },
          end: { line: 1 },
          extra: { message: 'm', severity: 'warning' },
        },
      ],
    });
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings[0]?.severity).toBe('WARNING');
    }
  });
});

describe('parseSemgrepJson — non-fatal errors', () => {
  it('surfaces non-fatal errors from semgrep stdout', () => {
    const stdout = JSON.stringify({
      results: [],
      errors: [
        { message: 'rule parse error in rules/authz/foo.yaml', type: 'rule' },
        { message: 'cannot read file', type: 'io' },
      ],
    });
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.nonFatalErrors.length).toBe(2);
      expect(result.value.nonFatalErrors[0]).toContain('rule parse error');
    }
  });
});

describe('parseSemgrepJson — malformed inputs', () => {
  it('returns ScannerOutputParseError for non-JSON stdout', async () => {
    const stdout = await loadFixture('malformed');
    const result = parseSemgrepJson(stdout);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
      expect(result.error.scannerName).toBe('semgrep');
    }
  });

  it('returns ScannerOutputParseError when JSON root is not an object', () => {
    const result = parseSemgrepJson('[1, 2, 3]');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });

  it('returns ScannerOutputParseError when results is not an array', () => {
    const result = parseSemgrepJson('{"results": "not an array"}');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });

  it('skips malformed result entries silently rather than failing the whole parse', () => {
    const stdout = JSON.stringify({
      results: [
        'not-an-object',
        {
          check_id: 'r1',
          path: 'f.ts',
          start: { line: 1 },
          end: { line: 1 },
          extra: { message: 'm', severity: 'WARNING' },
        },
      ],
    });
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.findings.length).toBe(1);
      expect(result.value.findings[0]?.ruleId).toBe('r1');
    }
  });
});

describe('parseSemgrepJson — classification discipline', () => {
  // Step 07 Guardrails: "Rules must not produce confirmed_issue blindly."
  // The adapter's normalized shape doesn't carry findingType — the
  // consuming agent decides classification from severity + heuristic
  // strength. This test asserts the shape so a future refactor can't
  // silently smuggle a classification field through.
  it('never carries findingType on a SemgrepFinding', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseSemgrepJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value.findings) {
        const record = f as unknown as Record<string, unknown>;
        expect(record['findingType']).toBeUndefined();
        expect(record['finding_type']).toBeUndefined();
      }
    }
  });
});
