import { describe, expect, it } from 'vitest';

import {
  PROBE_PRIMITIVE_CATALOG,
  EXPECTED_PROBE_IDS,
  getProbePrimitive,
} from './index.js';

/**
 * Step 39b V6 (codex 39b-deferred-tests-are-load-bearing [APPLIED]) —
 * 4-direction policy-gate behavior at the probe-http descriptor's
 * `requiredActionForArgs` hook layer.
 *
 * The agentic-loop's two-path gate (`agentic-loop.ts` Decision H code)
 * is exercised by:
 *  - 951 existing tests on Path A (no regression in the gate-order
 *    rewiring — descriptors without the hook stay on the static-action
 *    enforce-then-parse path).
 *  - The hook tests below, which assert the DYNAMIC capability set
 *    derivation that Path B reads.
 *
 * V6 has 4 directions:
 *  (a) Mode A (only read_code) → all 12 probes' requiredActions include
 *      call_api_with_test_identity which is NOT in Mode A → loop denies.
 *  (b) Full Mode B → all 12 probes' requiredActions are subsets of
 *      Mode B's allowed_actions → loop allows.
 *  (c) Partial Mode B (only call_api_with_test_identity, missing
 *      create_synthetic_record / cleanup_veyra_created_data) → 39b's
 *      observational scope means NO probe needs the create/cleanup
 *      actions; the partial-policy gates them all. (After 39b's
 *      cleanup-strategy scope-down, ALL 12 probes declare only
 *      call_api_with_test_identity. The original codex finding flagged
 *      this expectation; we land it as: partial Mode B that includes
 *      call_api_with_test_identity allows all 12 in 39b. cc-11-4's
 *      active POST + cleanup-aware variant is deferred and would
 *      reintroduce the partial-policy DENY case.)
 *  (d) Unknown probe_id → hook returns empty array → loop maps to deny.
 */

describe('V6(a) — every primitive declares call_api_with_test_identity', () => {
  it('all probe primitives require Mode B', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      expect(p.requiredActions).toContain('call_api_with_test_identity');
    }
  });

  it('Mode A (read_only_evidence default) denies every probe via the hook', () => {
    const modeAActions = new Set([
      'read_code',
      'read_schema_metadata',
      'read_storage_metadata',
      'read_scanner_logs',
      'author_hypothesis',
    ]);
    for (const id of EXPECTED_PROBE_IDS) {
      const primitive = getProbePrimitive(id);
      expect(primitive).toBeDefined();
      if (primitive === undefined) continue;
      const allActionsAllowed = primitive.requiredActions.every((a) =>
        modeAActions.has(a),
      );
      expect(
        allActionsAllowed,
        `primitive ${id} requires actions not in Mode A: ${primitive.requiredActions.filter((a) => !modeAActions.has(a)).join(', ')}`,
      ).toBe(false);
    }
  });
});

describe('V6(b) — full Mode B allows every probe via the hook', () => {
  it('Mode B (sandbox_active_validation default) covers every primitive.requiredActions', () => {
    const modeBActions = new Set([
      'read_code',
      'read_schema_metadata',
      'read_storage_metadata',
      'read_scanner_logs',
      'author_hypothesis',
      'create_synthetic_user',
      'create_synthetic_tenant',
      'create_synthetic_record',
      'call_api_with_test_identity',
      'verify_denial',
      'cleanup_veyra_created_data',
    ]);
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      for (const a of p.requiredActions) {
        expect(
          modeBActions.has(a),
          `primitive ${p.id} declares action "${String(a)}" missing from default Mode B`,
        ).toBe(true);
      }
    }
  });
});

describe('V6(c) — partial Mode B (only call_api_with_test_identity) — 39b scope', () => {
  it('every probe in 39b can run under a custom partial Mode B (no create/cleanup needed)', () => {
    // 39b's observational scope: NO probe declares create_synthetic_record
    // or cleanup_veyra_created_data; the codex 39b-cleanup-strategy fix
    // narrowed cc-11-4 + cc-11-13b/c/d/e to audit_only GETs.
    // A future step that adds an active POST variant (cc-11-4 active form)
    // will reintroduce the partial-policy-deny case; V6c flips at that
    // point.
    const partialActions = new Set(['call_api_with_test_identity']);
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      for (const a of p.requiredActions) {
        expect(
          partialActions.has(a),
          `primitive ${p.id} requires action "${String(a)}" outside partial Mode B (39b expected scope: only call_api_with_test_identity)`,
        ).toBe(true);
      }
    }
  });
});

describe('V6(d) — unknown probe_id → hook returns empty → loop denies', () => {
  it('the catalog returns undefined for unknown ids', () => {
    expect(getProbePrimitive('cc-11-99-fake-future-probe')).toBeUndefined();
    expect(getProbePrimitive('execute_sql')).toBeUndefined();
    expect(getProbePrimitive('')).toBeUndefined();
  });
});
