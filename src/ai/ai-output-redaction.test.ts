import { describe, expect, it } from 'vitest';

import { createRedactor } from './ai-output-redaction.js';

// Build a fake-token-shaped string at runtime so the source file itself
// contains no raw-token literal (matches CLAUDE.md §Secrets + the
// pre-write-secret-scan hook).
const FAKE_TOKEN = ['ghp', 'abcdefghijklmnopqrstuv'].join('_');

describe('ai-output-redaction stable-alias redactor (Step 34)', () => {
  it('replaces an email with REDACTED_EMAIL_1', () => {
    const r = createRedactor();
    expect(r.redactString('contact: user@example.com please')).toBe(
      'contact: REDACTED_EMAIL_1 please',
    );
  });

  it('replaces a URL with REDACTED_URL_1', () => {
    const r = createRedactor();
    expect(r.redactString('see https://example.com/path?x=1 now')).toBe(
      'see REDACTED_URL_1 now',
    );
  });

  it('replaces a token-shaped string with REDACTED_TOKEN_1', () => {
    const r = createRedactor();
    const out = r.redactString(`Authorization: Bearer ${FAKE_TOKEN}`);
    expect(out).toContain('REDACTED_TOKEN_1');
    expect(out).not.toContain(FAKE_TOKEN);
  });

  it('replaces a UUID with REDACTED_ID_1', () => {
    const r = createRedactor();
    expect(
      r.redactString('row 550e8400-e29b-41d4-a716-446655440000 missing'),
    ).toBe('row REDACTED_ID_1 missing');
  });

  it('same raw value across calls maps to the same alias (stable)', () => {
    const r = createRedactor();
    const a = r.redactString('https://example.com/x');
    const b = r.redactString('see https://example.com/x again');
    expect(a).toBe('REDACTED_URL_1');
    expect(b).toBe('see REDACTED_URL_1 again');
  });

  it('different raw values get distinct increasing aliases per kind', () => {
    const r = createRedactor();
    expect(r.redactString('a@b.com and c@d.com')).toBe(
      'REDACTED_EMAIL_1 and REDACTED_EMAIL_2',
    );
  });

  it('redacts recursively through arrays + objects', () => {
    const r = createRedactor();
    const out = r.redact({
      a: 'https://x.io/1',
      b: ['user@x.io', 'https://x.io/1'], // same URL → same alias as a
      c: { nested: 'row 550e8400-e29b-41d4-a716-446655440000' },
      n: 42,
    });
    expect(out).toEqual({
      a: 'REDACTED_URL_1',
      b: ['REDACTED_EMAIL_1', 'REDACTED_URL_1'],
      c: { nested: 'row REDACTED_ID_1' },
      n: 42,
    });
  });

  it('aliasMap snapshots all known aliases', () => {
    const r = createRedactor();
    r.redactString('user@x.io and https://x.io');
    const m = r.aliasMap();
    expect(m.map((e) => e.kind).sort()).toEqual(['EMAIL', 'URL']);
    expect(m.map((e) => e.alias).sort()).toEqual([
      'REDACTED_EMAIL_1',
      'REDACTED_URL_1',
    ]);
  });
});
