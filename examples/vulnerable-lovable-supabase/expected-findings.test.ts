import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Step 04 placeholder integration assertion. Loads `expected-findings.json`
 * and asserts the file is well-formed. Step 19 (fixture validation gate)
 * expands this to compare against actual scan output.
 *
 * This test lives next to the fixture rather than under `src/` so the
 * coupling between the fixture's shape and Veyra's expectations stays
 * adjacent to the data it describes.
 */

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

interface MustSurfaceEntry {
  readonly control_id: string;
  readonly finding_type: string;
  readonly mcp_dependent: boolean;
  readonly fixture_anchor: string;
  readonly description: string;
  readonly evidence_strength?: string;
}

interface CoverageGapEntry {
  readonly control_id: string;
  readonly when: string;
  readonly rationale: string;
}

interface MustNotSurfaceEntry {
  readonly anchor: string;
  readonly rationale: string;
}

interface ExpectedFindings {
  readonly must_surface: readonly MustSurfaceEntry[];
  readonly must_be_coverage_gap: readonly CoverageGapEntry[];
  readonly must_not_surface: readonly MustNotSurfaceEntry[];
}

const CONTROL_ID_PATTERN = /^cc-11-(?:[1-9]|1[0-2])$/;
const ALLOWED_FINDING_TYPES = new Set([
  'likely_issue',
  'confirmed_issue',
  'missing_evidence',
  'coverage_gap',
]);

async function loadManifest(): Promise<ExpectedFindings> {
  const raw = await fs.readFile(
    path.join(FIXTURE_DIR, 'expected-findings.json'),
    'utf8',
  );
  return JSON.parse(raw) as ExpectedFindings;
}

describe('vulnerable-lovable-supabase: expected-findings.json', () => {
  it('parses as JSON with the three documented sections', async () => {
    const parsed = await loadManifest();
    expect(Array.isArray(parsed.must_surface)).toBe(true);
    expect(Array.isArray(parsed.must_be_coverage_gap)).toBe(true);
    expect(Array.isArray(parsed.must_not_surface)).toBe(true);
  });

  it('must_surface covers every cc-11-N from FPP §11 (12 control ids, no duplicates)', async () => {
    const parsed = await loadManifest();
    const ids = parsed.must_surface.map((e) => e.control_id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(12);
    for (let n = 1; n <= 12; n++) {
      expect(uniqueIds.has(`cc-11-${String(n)}`)).toBe(true);
    }
  });

  it('every must_surface entry has a valid control_id, finding_type, anchor', async () => {
    const parsed = await loadManifest();
    expect(parsed.must_surface.length).toBeGreaterThanOrEqual(12);
    for (const entry of parsed.must_surface) {
      expect(entry.control_id).toMatch(CONTROL_ID_PATTERN);
      expect(ALLOWED_FINDING_TYPES.has(entry.finding_type)).toBe(true);
      expect(typeof entry.fixture_anchor).toBe('string');
      expect(entry.fixture_anchor.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(typeof entry.mcp_dependent).toBe('boolean');
    }
  });

  it('cc-11-12 is flagged as MCP-dependent and listed as a coverage gap when MCP is off', async () => {
    const parsed = await loadManifest();
    const cc12 = parsed.must_surface.find((e) => e.control_id === 'cc-11-12');
    expect(cc12).toBeDefined();
    expect(cc12?.mcp_dependent).toBe(true);

    const gap = parsed.must_be_coverage_gap.find(
      (e) => e.control_id === 'cc-11-12',
    );
    expect(gap).toBeDefined();
    expect(gap?.when).toContain('--supabase-mcp');
  });

  it('must_not_surface enumerates at least 2 clean tables and 1 clean bucket', async () => {
    const parsed = await loadManifest();
    // step 04 Done-When: "≥2 seeded clean tables AND ≥1 clean bucket"
    expect(parsed.must_not_surface.length).toBeGreaterThanOrEqual(3);
    const anchors = parsed.must_not_surface.map((e) => e.anchor).join('\n');
    expect(anchors).toContain('public.timezones');
    expect(anchors).toContain('public.feature_flags');
    expect(anchors).toContain('internal-reports');
  });

  it('Gitleaks-detectable secret (cc-11-8) is classified confirmed_issue', async () => {
    const parsed = await loadManifest();
    const cc8 = parsed.must_surface.find((e) => e.control_id === 'cc-11-8');
    expect(cc8?.finding_type).toBe('confirmed_issue');
  });

  it('heuristic checks (cc-11-1..6, cc-11-9, cc-11-10, cc-11-12) stay likely, never confirmed', async () => {
    const parsed = await loadManifest();
    const heuristicIds = [
      'cc-11-1',
      'cc-11-2',
      'cc-11-3',
      'cc-11-4',
      'cc-11-5',
      'cc-11-6',
      'cc-11-9',
      'cc-11-10',
      'cc-11-12',
    ];
    for (const id of heuristicIds) {
      const entry = parsed.must_surface.find((e) => e.control_id === id);
      expect(entry?.finding_type).toBe('likely_issue');
    }
  });
});

interface ExpectedAiConcern {
  readonly category: 'no_predicate_fired' | 'insufficient_facts';
  readonly confidence: 'low' | 'medium' | 'high';
  readonly must_surface: boolean;
  readonly description: string;
  readonly fixture_anchor: string;
  readonly control_id?: string;
}

interface ExpectedAiConcernsArtifact {
  readonly must_surface: readonly ExpectedAiConcern[];
  readonly tolerated_low_confidence: readonly { readonly category: string; readonly rationale: string }[];
}

async function loadAiConcerns(): Promise<ExpectedAiConcernsArtifact> {
  const raw = await fs.readFile(
    path.join(FIXTURE_DIR, 'expected-ai-concerns.json'),
    'utf8',
  );
  return JSON.parse(raw) as ExpectedAiConcernsArtifact;
}

describe('vulnerable-lovable-supabase: expected-ai-concerns.json (04b)', () => {
  it('parses with the documented sections', async () => {
    const parsed = await loadAiConcerns();
    expect(Array.isArray(parsed.must_surface)).toBe(true);
    expect(Array.isArray(parsed.tolerated_low_confidence)).toBe(true);
  });

  it('every must_surface entry has a valid category, confidence, anchor', async () => {
    const parsed = await loadAiConcerns();
    for (const entry of parsed.must_surface) {
      expect(['no_predicate_fired', 'insufficient_facts']).toContain(
        entry.category,
      );
      expect(['low', 'medium', 'high']).toContain(entry.confidence);
      expect(entry.must_surface).toBe(true);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.fixture_anchor).toBe('string');
    }
  });

  it('control_id (when set) follows the cc-11-N convention', async () => {
    const parsed = await loadAiConcerns();
    for (const entry of parsed.must_surface) {
      if (entry.control_id !== undefined) {
        expect(entry.control_id).toMatch(CONTROL_ID_PATTERN);
      }
    }
  });
});

describe('cross-reference: control_ids span both manifests in lockstep', () => {
  it('every control_id in expected-ai-concerns appears in expected-findings.must_surface', async () => {
    const findings = await loadManifest();
    const concerns = await loadAiConcerns();
    const allFindingIds = new Set(findings.must_surface.map((e) => e.control_id));
    for (const c of concerns.must_surface) {
      if (c.control_id !== undefined) {
        expect(allFindingIds.has(c.control_id), `control ${c.control_id} not in expected-findings`).toBe(true);
      }
    }
  });
});
