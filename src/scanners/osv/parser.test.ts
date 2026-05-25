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

describe('parseOsvJson — pure observation (no scanner-side classification)', () => {
  // Step 06b removed scanner-side classification: `findingType`,
  // `evidenceStrength`, `reviewAction` are no longer parser fields.
  // Classification lives in the tool-runner agent's CLASSIFICATION map.
  it('emits no classification fields on OsvFinding (boundary check)', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseOsvJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        const record = f as unknown as Record<string, unknown>;
        expect(record['findingType']).toBeUndefined();
        expect(record['evidenceStrength']).toBeUndefined();
        expect(record['reviewAction']).toBeUndefined();
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
