import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ScannerOutputParseError } from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';

import { parseOsvJson } from './parser.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

describe('parseOsvJson — well-formed inputs', () => {
  it('returns an empty findings list for the no-findings fixture', async () => {
    const stdout = await loadFixture('no-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns an empty list for an empty stdout (osv-scanner runs that find nothing)', () => {
    const result = parseOsvJson('');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns an empty list when `results` key is missing entirely', () => {
    const result = parseOsvJson('{}');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('parses with-findings fixture into one finding per vulnerability', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.length).toBe(2);

      const first = result.value[0];
      expect(first?.vulnerabilityId).toBe('GHSA-cph5-m8f7-6c5x');
      expect(first?.aliases).toContain('CVE-2021-3749');
      expect(first?.packageName).toBe('axios');
      expect(first?.packageVersion).toBe('0.21.0');
      expect(first?.ecosystem).toBe('npm');
      expect(first?.summary).toContain('Axios');
      expect(first?.severity).toBeDefined();
    }
  });
});

describe('parseOsvJson — Done-When defaults', () => {
  // Done-when line 27: findings are tagged with `evidence_strength: medium`
  // and `review_action: review_before_launch` by default.
  it('tags every finding with findingType: likely_issue', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        expect(f.findingType).toBe('likely_issue');
      }
    }
  });

  it('tags every finding with evidenceStrength: medium', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        expect(f.evidenceStrength).toBe('medium');
      }
    }
  });

  it('tags every finding with reviewAction: review_before_launch', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        expect(f.reviewAction).toBe('review_before_launch');
      }
    }
  });

  // Guardrail (line 32): "Dependency findings must NOT be emitted as
  // confirmed_issue." The literal-type union locks this at compile time;
  // this test is a runtime back-stop.
  it('never tags a finding as confirmed_issue', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        expect(f.findingType).not.toBe('confirmed_issue');
      }
    }
  });
});

describe('parseOsvJson — malformed inputs', () => {
  it('returns ScannerOutputParseError for non-JSON stdout', async () => {
    const stdout = await loadFixture('malformed');
    const result = parseOsvJson(stdout);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
      expect(result.error.scannerName).toBe('osv-scanner');
    }
  });

  it('returns ScannerOutputParseError when JSON root is not an object', () => {
    const result = parseOsvJson('[1, 2, 3]');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });

  it('returns ScannerOutputParseError when results is not an array', () => {
    const result = parseOsvJson('{"results": "not an array"}');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
      expect(result.error.message).toContain('not an array');
    }
  });

  it('skips malformed sub-entries silently rather than failing the whole parse', () => {
    const stdout = JSON.stringify({
      results: [
        { packages: 'not an array' },
        {
          packages: [
            {
              package: { name: 'foo', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [
                { id: 'GHSA-real', summary: 'real one', aliases: [] },
                'not-an-object',
              ],
            },
          ],
        },
      ],
    });
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]?.vulnerabilityId).toBe('GHSA-real');
    }
  });
});
