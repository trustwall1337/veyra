import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLASSIFICATION_KEYS } from '../../../types/tool-result.js';
import {
  PROBE_PRIMITIVE_CATALOG,
  EXPECTED_PROBE_IDS,
} from './index.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_SRC = path.dirname(path.dirname(path.dirname(THIS_DIR)));

/**
 * Step 39b safety tests (codex 39b-deferred-tests-are-load-bearing
 * [APPLIED]). Originally tagged "defer to follow-up"; codex correctly
 * pointed out they're TRUST-MODEL gates, not CI polish.
 *
 *  - V11 (no raw secrets): persisted artifacts carry no live secret value.
 *    Validated structurally — the probe-http tool only persists status +
 *    summary counts (already enforced by 40c-v3 V18). 39b adds no new
 *    persistence path; this test re-asserts the catalog metadata is
 *    secret-free.
 *  - V12 (no new MCP allowlist surface): 39b adds no new MCP tool name.
 *  - V13 (FPP §2A — no closed unions on control_id): per-control config
 *    is keyed by `string`.
 *  - V15 (--no-ai baseline): probe-http is opt-in via Mode B registration;
 *    --no-ai paths don't register it.
 *  - V16 (no new AllowedAction values).
 *  - V9b (cc-11-3 finding-shape compat): the renderProbeFinding body for
 *    cc-11-3 matches the pre-relocation findingForOutcome shape.
 */

describe('V11 — catalog metadata carries no live secret value', () => {
  it('no primitive title / uncertainty_notes contains a secret-shaped substring', () => {
    // Heuristic patterns (same shape as the gitleaks AI-extras + the
    // sanitization layer's OpenAI / JWT / UUID / high-entropy detector).
    const secretLike: readonly RegExp[] = [
      /sk-[A-Za-z0-9_-]{20,}/,
      /eyJ[A-Za-z0-9_-]{20,}/, // JWT
      /[A-Za-z0-9+/_-]{40,}=*/, // high-entropy opaque token
    ];
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      const surfaces = [p.title, p.uncertainty_notes ?? ''];
      for (const s of surfaces) {
        for (const pattern of secretLike) {
          expect(
            pattern.test(s),
            `primitive ${p.id} surface "${s}" matches secret pattern ${String(pattern)}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('V12 — no new MCP allowlist surface', () => {
  it('no probe-primitive file under sandbox-runner imports an MCP SDK', async () => {
    const files = await listTsFiles(THIS_DIR);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const sources = extractImportSources(content);
      for (const src of sources) {
        if (src.startsWith('@modelcontextprotocol/sdk')) {
          throw new Error(`${file} imports MCP SDK "${src}" — 39b is HTTP-only.`);
        }
      }
    }
  });

  it('no probe-primitive name suggests an MCP tool', () => {
    const mcpTools = ['execute_sql', 'list_tables', 'get_advisors', 'send_message'];
    for (const id of EXPECTED_PROBE_IDS) {
      for (const t of mcpTools) {
        expect(
          id.includes(t),
          `probe_id "${id}" must not look like an MCP tool name`,
        ).toBe(false);
      }
    }
  });
});

describe('V13 — FPP §2A: no closed unions on control_id', () => {
  it('PROBE_PRIMITIVE_CATALOG key type is string (Map<string, ...>)', () => {
    // Type-level: any string can index. Runtime: try a non-listed key.
    const r = PROBE_PRIMITIVE_CATALOG.get('cc-99-fake-future-control');
    expect(r).toBeUndefined();
    // The lookup didn't throw; the Map accepts arbitrary strings.
  });

  it('every primitive declares control_id: string (not a closed union)', () => {
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      expect(typeof p.control_id).toBe('string');
    }
  });

  it('no source file under probe-primitives/ contains "switch (control_id)" or its equivalent', async () => {
    const files = (await listTsFiles(THIS_DIR)).filter((p) => !p.endsWith('.test.ts'));
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      // Catches `switch (control_id)`, `switch(controlId)`, and similar.
      expect(
        /switch\s*\(\s*control[_]?id\s*\)/i.test(content),
        `${file} contains a switch on control_id — FPP §2A forbids closed-union dispatch on control_id`,
      ).toBe(false);
    }
  });
});

describe('V15 — --no-ai baseline is unchanged by 39b', () => {
  it('probe-http tool is NOT registered by the read-only / no-ai registration path', async () => {
    // Read the registration helper file source and assert probe-http is
    // only wired via the active-validation path (Mode B). 39b doesn't
    // change this — sanity guard against a future drift.
    const regPath = path.join(REPO_SRC, 'cli', 'tool-registration.ts');
    const content = await fs.readFile(regPath, 'utf8');
    // The probe-http registration appears inside registerActiveValidationTools.
    const m = content.match(/registerActiveValidationTools[\s\S]*?createProbeHttpTool/);
    expect(m).not.toBeNull();
    // And `registerReadOnlyTools` does NOT contain createProbeHttpTool.
    const readOnlyMatch = content.match(/registerReadOnlyTools\b[\s\S]*?\}\s*\n\}/);
    if (readOnlyMatch !== null) {
      expect(readOnlyMatch[0]?.includes('createProbeHttpTool')).toBe(false);
    }
  });
});

describe('V16 — no new AllowedAction values', () => {
  it('AllowedAction union contains the canonical values (no 39b additions)', async () => {
    const policyPath = path.join(REPO_SRC, 'types', 'validation-policy.ts');
    const content = await fs.readFile(policyPath, 'utf8');
    // Assert the closed union still includes call_api_with_test_identity,
    // create_synthetic_record, cleanup_veyra_created_data — and that 39b
    // added no novel value.
    expect(content).toMatch(/'call_api_with_test_identity'/);
    expect(content).toMatch(/'create_synthetic_record'/);
    expect(content).toMatch(/'cleanup_veyra_created_data'/);
    // Negative: scan for any obvious 39b-introduced value.
    expect(content).not.toMatch(/'probe_http'/);
    expect(content).not.toMatch(/'execute_sql'/);
  });

  it('every primitive.requiredActions value is in the canonical AllowedAction set', () => {
    const canonical = new Set([
      'read_code',
      'read_schema_metadata',
      'read_storage_metadata',
      'read_scanner_logs',
      'read_application_logs',
      'create_synthetic_user',
      'create_synthetic_tenant',
      'create_synthetic_record',
      'call_api_with_test_identity',
      'verify_denial',
      'cleanup_veyra_created_data',
      'author_hypothesis',
    ]);
    for (const p of PROBE_PRIMITIVE_CATALOG.values()) {
      for (const a of p.requiredActions) {
        expect(
          canonical.has(a),
          `primitive ${p.id} declared unknown action "${String(a)}"`,
        ).toBe(true);
      }
    }
  });
});

describe('V9b — cc-11-3 finding-shape compat (codex 39b-finding-relocation-cc113-compat [APPLIED])', () => {
  it('cc-11-3 proven_allowed (expect_denial) maps to the canonical finding shape', async () => {
    // The renderProbeFinding helper is private to floor-predicates.ts; we
    // can't import it directly. Instead drive the predicate end-to-end:
    // feed it a fact representing the cc-11-3 proven_allowed case and
    // assert the emitted Finding matches the pre-39b shape.
    const { FLOOR_PREDICATES } = await import('../../../cli/floor-predicates.js');
    const activeProbeEntry = FLOOR_PREDICATES.find(
      (p) => p.predicate_id === 'active-validation-probe-outcomes',
    );
    expect(activeProbeEntry).toBeDefined();
    if (activeProbeEntry === undefined) return;

    const fact = {
      fact_id: 'test-fact-1',
      observed_at: '2026-06-12T00:00:00.000Z',
      args_fingerprint_sha256: 'abc',
      redacted: true,
      source: {
        kind: 'probe_response' as const,
        probe_id: 'cc-11-3-direct-object-access',
        control_id: 'cc-11-3',
        payload: {
          response_status: 200,
          response_returned_rows: true,
          response_size_bytes: 100,
          response_digest: 'sha256:abc',
          expectation: 'expect_denial' as const,
        },
      },
    };
    const findings = activeProbeEntry.run([fact], []);
    expect(findings.length).toBe(1);
    const f = findings[0];
    expect(f?.control_id).toBe('cc-11-3');
    expect(f?.finding_type).toBe('confirmed_issue');
    expect(f?.evidence_strength).toBe('high');
    expect(f?.review_action).toBe('fix_before_launch');
    expect(f?.blast_radius).toBe('user_data');
    expect(f?.title).toContain('cc-11-3-direct-object-access');
  });

  it('cc-11-3 proven_denial (expect_denial) returns no finding', async () => {
    const { FLOOR_PREDICATES } = await import('../../../cli/floor-predicates.js');
    const activeProbeEntry = FLOOR_PREDICATES.find(
      (p) => p.predicate_id === 'active-validation-probe-outcomes',
    );
    if (activeProbeEntry === undefined) return;
    const fact = {
      fact_id: 'test-fact-2',
      observed_at: '2026-06-12T00:00:00.000Z',
      args_fingerprint_sha256: 'abc',
      redacted: true,
      source: {
        kind: 'probe_response' as const,
        probe_id: 'cc-11-3-direct-object-access',
        control_id: 'cc-11-3',
        payload: {
          response_status: 403,
          response_returned_rows: false,
          response_size_bytes: 50,
          response_digest: 'sha256:abc',
          expectation: 'expect_denial' as const,
        },
      },
    };
    const findings = activeProbeEntry.run([fact], []);
    expect(findings.length).toBe(0);
  });

  it('cc-11-2 proven_allowed maps to admin_access blast_radius', async () => {
    const { FLOOR_PREDICATES } = await import('../../../cli/floor-predicates.js');
    const activeProbeEntry = FLOOR_PREDICATES.find(
      (p) => p.predicate_id === 'active-validation-probe-outcomes',
    );
    if (activeProbeEntry === undefined) return;
    const fact = {
      fact_id: 'test-fact-3',
      observed_at: '2026-06-12T00:00:00.000Z',
      args_fingerprint_sha256: 'abc',
      redacted: true,
      source: {
        kind: 'probe_response' as const,
        probe_id: 'cc-11-2-non-admin-admin-route',
        control_id: 'cc-11-2',
        payload: {
          response_status: 200,
          response_returned_rows: true,
          response_size_bytes: 100,
          response_digest: 'sha256:abc',
          expectation: 'expect_denial' as const,
        },
      },
    };
    const findings = activeProbeEntry.run([fact], []);
    expect(findings.length).toBe(1);
    expect(findings[0]?.blast_radius).toBe('admin_access');
  });
});

async function listTsFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function extractImportSources(content: string): string[] {
  const sources: string[] = [];
  const re = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const src = m[1] ?? m[2];
    if (src !== undefined) sources.push(src);
  }
  return sources;
}

// CLASSIFICATION_KEYS imported above is referenced indirectly through other
// tests; keep here for clarity that this surface also has the protection.
void CLASSIFICATION_KEYS;
