import { describe, expect, it } from 'vitest';

import { PROBE_PRIMITIVE_CATALOG } from './index.js';

/**
 * Step 39b V4 + V4b — URL-builder Zod-parse discipline (codex 39b-004
 * [APPLIED]). For each probe with AI-authored identifier-shaped fields,
 * seed adversarial inputs (URL-fragment characters, traversal, encoded
 * percent, etc.) and assert each REJECTS at Zod parse — registry
 * untouched, no URL produced.
 */

const ADVERSARIAL_STRINGS: readonly string[] = [
  'foo&bar', // ampersand
  'foo?bar', // question mark
  'foo/bar', // forward slash
  '..', // path traversal
  'foo=bar', // equals
  'foo(bar)', // parens
  '%2F', // encoded slash
  'foo bar', // space
  '', // empty
];

describe('V4 — Zod schemas reject URL-fragment / traversal characters in identifier fields', () => {
  it('cc-11-3 path_params.id rejects adversarial inputs', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-3-direct-object-access');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const idField = p.requestSchema.pathParams['id'];
    expect(idField).toBeDefined();
    if (idField === undefined || idField.mode !== 'ai_authored') return;
    for (const bad of ADVERSARIAL_STRINGS) {
      const r = idField.schema.safeParse(bad);
      expect(r.success, `expected reject for "${bad}"`).toBe(false);
    }
  });

  it('cc-11-6 path_params.table rejects URL-fragment characters', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-6-broad-rls-cross-tenant');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const tableField = p.requestSchema.pathParams['table'];
    expect(tableField).toBeDefined();
    if (tableField === undefined || tableField.mode !== 'ai_authored') return;
    for (const bad of ADVERSARIAL_STRINGS) {
      const r = tableField.schema.safeParse(bad);
      expect(r.success, `expected reject for "${bad}"`).toBe(false);
    }
  });
});

describe('V4 — structured filter / embed schemas reject smuggled syntax', () => {
  it('cc-11-13c filter rejects raw query syntax in the value field', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-13c-cross-tenant-filter-bypass');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const filterField = p.requestSchema.pathParams['filter'];
    expect(filterField).toBeDefined();
    if (filterField === undefined || filterField.mode !== 'ai_authored') return;

    // operator: enum
    const badOp = filterField.schema.safeParse({
      tenantColumn: 'tenant_id',
      operator: 'or_bypass',
      value: 'tenantB',
    });
    expect(badOp.success).toBe(false);

    // value with smuggled query syntax
    for (const bad of ['tenantB&tenantC', 'tenantB,extra', 'tenantB?next', '']) {
      const r = filterField.schema.safeParse({
        tenantColumn: 'tenant_id',
        operator: 'neq',
        value: bad,
      });
      expect(r.success, `expected reject for value="${bad}"`).toBe(false);
    }
  });

  it('cc-11-13d embed schema enforces min/max bounds on column arrays', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-13d-foreign-table-embed-leak');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const embedField = p.requestSchema.pathParams['embed'];
    expect(embedField).toBeDefined();
    if (embedField === undefined || embedField.mode !== 'ai_authored') return;

    // Empty parentColumns → reject
    const empty = embedField.schema.safeParse({
      parentColumns: [],
      foreignTable: 'users',
      foreignColumns: ['email'],
    });
    expect(empty.success).toBe(false);

    // >8 parentColumns → reject
    const tooMany = embedField.schema.safeParse({
      parentColumns: Array.from({ length: 9 }, (_, i) => `col${String(i)}`),
      foreignTable: 'users',
      foreignColumns: ['email'],
    });
    expect(tooMany.success).toBe(false);
  });
});

describe('V4b — URL builders produce clean URLs at max bounds', () => {
  it('cc-11-13c filter at max value-length produces a parseable PostgREST query', () => {
    const p = PROBE_PRIMITIVE_CATALOG.get('cc-11-13c-cross-tenant-filter-bypass');
    if (p === undefined) return;
    const filterField = p.requestSchema.pathParams['filter'];
    if (filterField === undefined || filterField.mode !== 'ai_authored') return;
    const valid = filterField.schema.safeParse({
      tenantColumn: 'tenant_id',
      operator: 'neq',
      value: 'a'.repeat(64),
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      // Result is a transformed string; passes through URL-decoding cleanly.
      expect(typeof valid.data).toBe('string');
      expect(valid.data).toMatch(/^tenant_id=neq\./);
    }
  });
});

// V9c (codex 39b-url-schema-dynamic-keys [APPLIED]) — N/A in 39b scope.
// cc-11-4 was reshaped to a GET observational probe per the codex 39b-diff
// finding 39b-cleanup-strategy-not-enforced disposition; it carries
// `bodySchema: z.undefined()` and has no AI-authored record payload to
// guard. The bounded-record + classification-key + prototype-pollution
// discipline (V9c) applies if a future step reintroduces an AI-authored
// record body — V9c-equivalent tests would land alongside that probe.
