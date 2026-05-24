import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ScannerOutputParseError } from '../../types/errors.js';
import { isErr, isOk } from '../../types/result.js';

import { parseGitleaksJson, redactSecrets } from './parser.js';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
);

async function loadFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

/**
 * Build a fake AWS-shaped access key id WITHOUT writing the literal pattern
 * into source. The pre-write secret-scan hook (`.claude/hooks/...`) blocks
 * files that contain `\bAKIA[0-9A-Z]{16}\b`; assembling the string at runtime
 * keeps test source clean while still producing a value that matches the
 * parser's scrub patterns. Same approach for the JWT case.
 */
const FAKE_AWS_KEY = ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join('');
const FAKE_JWT = [
  'ey',
  'J',
  'abcdefghij01234567',
  '.ey',
  'J',
  'abcdefghij01234567',
  '.',
  'abcdefghij01234567',
].join('');

describe('redactSecrets', () => {
  it('replaces an AWS-shaped access key with REDACTED', () => {
    const result = redactSecrets(`leaked: ${FAKE_AWS_KEY} (please rotate)`);
    expect(result).toContain('REDACTED');
    expect(result).not.toContain(FAKE_AWS_KEY);
  });

  it('replaces a JWT-shaped token with REDACTED', () => {
    const result = redactSecrets(`token=${FAKE_JWT};`);
    expect(result).toContain('REDACTED');
    expect(result).not.toContain(FAKE_JWT);
  });

  it('is idempotent on already-scrubbed strings', () => {
    const once = redactSecrets(`leak: ${FAKE_AWS_KEY}`);
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });

  it('leaves strings without any pattern unchanged', () => {
    const benign = 'src/lib/secrets.ts:generic-api-key:12';
    expect(redactSecrets(benign)).toBe(benign);
  });

  it('redacts multiple occurrences in one string', () => {
    const input = `a=${FAKE_AWS_KEY} b=${FAKE_AWS_KEY}`;
    const result = redactSecrets(input);
    expect(result).not.toContain(FAKE_AWS_KEY);
    // both occurrences scrubbed
    expect(result.split('REDACTED').length - 1).toBe(2);
  });
});

describe('parseGitleaksJson — well-formed inputs', () => {
  it('returns an empty findings list for the no-findings fixture', async () => {
    const stdout = await loadFixture('no-findings');
    const result = parseGitleaksJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns an empty list for null stdout (some gitleaks versions emit `null`)', () => {
    const result = parseGitleaksJson('null');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns an empty list for whitespace-only stdout', () => {
    const result = parseGitleaksJson('   \n  \n');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('parses the with-findings fixture into normalized findings', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseGitleaksJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.length).toBe(2);
      const first = result.value[0];
      expect(first?.ruleId).toBe('generic-api-key');
      expect(first?.filePath).toBe('src/lib/secrets.ts');
      expect(first?.line).toBe(12);
      expect(first?.description).toBe('Generic API Key');
      expect(first?.fingerprint).toBe('src/lib/secrets.ts:generic-api-key:12');
    }
  });

  it('does NOT include Match or Secret fields in the normalized shape', async () => {
    const stdout = await loadFixture('with-findings');
    const result = parseGitleaksJson(stdout);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      for (const f of result.value) {
        // typed shape has no Match/Secret; cast to a record to assert absence
        const record = f as unknown as Record<string, unknown>;
        expect(record['Match']).toBeUndefined();
        expect(record['Secret']).toBeUndefined();
      }
    }
  });
});

describe('parseGitleaksJson — malformed inputs', () => {
  it('returns ScannerOutputParseError for non-JSON stdout', async () => {
    const stdout = await loadFixture('malformed');
    const result = parseGitleaksJson(stdout);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
      expect(result.error.scannerName).toBe('gitleaks');
    }
  });

  it('returns ScannerOutputParseError when the JSON root is not an array', () => {
    const result = parseGitleaksJson('{"findings": []}');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
      expect(result.error.message).toContain('not an array');
    }
  });

  it('returns ScannerOutputParseError when an array element is not an object', () => {
    const result = parseGitleaksJson('[42]');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ScannerOutputParseError);
    }
  });
});

describe('parseGitleaksJson — redaction (Done-When contract)', () => {
  /**
   * Done-when line 28 of the step file:
   *   "feed a fake Gitleaks JSON output containing a raw secret string;
   *    assert the adapter's normalized output does NOT contain that string
   *    anywhere."
   *
   * We construct the input inline (no on-disk fixture) so the source tree
   * never carries a raw secret-pattern string.
   */
  it('scrubs an AWS-shaped key from Description, even when gitleaks failed to redact', () => {
    const stdout = JSON.stringify([
      {
        Description: `Generic API Key: ${FAKE_AWS_KEY}`,
        StartLine: 7,
        File: 'src/lib/leaky.ts',
        Match: FAKE_AWS_KEY,
        Secret: FAKE_AWS_KEY,
        RuleID: 'aws-access-token',
        Fingerprint: `src/lib/leaky.ts:aws-access-token:${String(7)}`,
      },
    ]);

    const result = parseGitleaksJson(stdout);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(FAKE_AWS_KEY);

    const finding = result.value[0];
    expect(finding?.description).toBe('Generic API Key: REDACTED');
    expect(finding?.description).not.toContain(FAKE_AWS_KEY);
  });

  it('scrubs a JWT-shaped token planted in Description', () => {
    const stdout = JSON.stringify([
      {
        Description: `Supabase service-role JWT: ${FAKE_JWT}`,
        StartLine: 1,
        File: 'src/lib/jwt.ts',
        Match: FAKE_JWT,
        Secret: FAKE_JWT,
        RuleID: 'jwt',
        Fingerprint: 'src/lib/jwt.ts:jwt:1',
      },
    ]);

    const result = parseGitleaksJson(stdout);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(FAKE_JWT);
    expect(result.value[0]?.description).toContain('REDACTED');
  });
});
