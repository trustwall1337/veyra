import { describe, expect, it } from 'vitest';

import type { Finding } from './finding.js';
import {
  CLASSIFICATION_KEYS,
  type ClassificationKey,
  type ToolResult,
  type WithoutClassificationKeys,
  containsClassificationKey,
  toolResultBaseSchema,
} from './tool-result.js';

// ── Compile-time guards ─────────────────────────────────────────────────────
// These never run; their value is that the file type-checks. `pnpm typecheck`
// (and Vitest's transform) fail the build if any assertion below is wrong.

// The five forbidden keys must all be real Finding discriminators. A typo in
// CLASSIFICATION_KEYS would make this assignment fail to compile.
type _ClassificationKeysAreFindingKeys =
  ClassificationKey extends keyof Finding ? true : false;
const _classificationKeysAreFindingKeys: _ClassificationKeysAreFindingKeys =
  true;

// WithoutClassificationKeys resolves to the type when clean, `never` when not.
type _CleanStays = WithoutClassificationKeys<{ facts: [] }> extends never
  ? false
  : true;
const _cleanStays: _CleanStays = true;
type _DirtyBecomesNever = WithoutClassificationKeys<{
  finding_type: string;
}> extends never
  ? true
  : false;
const _dirtyBecomesNever: _DirtyBecomesNever = true;

describe('ToolResult — compile-time classification ban (verification a)', () => {
  it('does not allow a top-level classification key on a ToolResult literal', () => {
    // @ts-expect-error a ToolResult may not carry a top-level classification key
    const bad: ToolResult = { facts: [], finding_type: 'likely_issue' };
    expect(bad.facts).toEqual([]);
    // Reference the compile-time assertions so they are not "unused".
    expect(_classificationKeysAreFindingKeys).toBe(true);
    expect(_cleanStays).toBe(true);
    expect(_dirtyBecomesNever).toBe(true);
  });

  it('pins the forbidden-key list to exactly the five Finding verdict keys', () => {
    expect([...CLASSIFICATION_KEYS].sort()).toEqual(
      [
        'blast_radius',
        'evidence_strength',
        'finding_type',
        'reproducibility',
        'review_action',
      ].sort(),
    );
  });
});

describe('ToolResult — runtime classification ban (verification b)', () => {
  it('accepts a classification-free fact payload', () => {
    const parsed = toolResultBaseSchema.safeParse({
      facts: [
        { name: 'table_count', value: 3 },
        { name: 'tables', value: [{ name: 'users', value: 'rls_enabled' }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('.strict() rejects a classification key at the top level', () => {
    const parsed = toolResultBaseSchema.safeParse({
      facts: [],
      finding_type: 'likely_issue',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a classification key nested one level deep', () => {
    const parsed = toolResultBaseSchema.safeParse({
      facts: [{ name: 'a', value: { review_action: 'fix_before_launch' } }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a classification key nested several levels deep', () => {
    const parsed = toolResultBaseSchema.safeParse({
      facts: [
        {
          name: 'a',
          value: [{ name: 'b', value: { evidence_strength: 'low' } }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an extra classification key on a named fact', () => {
    const parsed = toolResultBaseSchema.safeParse({
      facts: [{ name: 'a', value: 'ok', blast_radius: 'tenant_data' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('containsClassificationKey — recursive deny-walk', () => {
  it('finds a classification key inside nested objects', () => {
    expect(containsClassificationKey({ a: { b: { finding_type: 1 } } })).toBe(
      true,
    );
  });

  it('finds a classification key inside arrays', () => {
    expect(containsClassificationKey({ a: [{ review_action: 1 }] })).toBe(true);
  });

  it('returns false for a classification-free structure', () => {
    expect(
      containsClassificationKey({ name: 'x', value: [1, 2, 'three'] }),
    ).toBe(false);
  });

  it('returns false for scalars', () => {
    expect(containsClassificationKey('scalar')).toBe(false);
    expect(containsClassificationKey(42)).toBe(false);
    expect(containsClassificationKey(null)).toBe(false);
  });
});
