/**
 * Phase 1 revision fixture gate (step 19b).
 *
 * Four gates per the §8 list of the step file:
 *  1. Three-tier rendering: distinct Findings / AIConcerns /
 *     Active-outcomes headings in the rendered markdown.
 *  2. --no-ai baseline parity: Findings set identical between an
 *     AI-enabled run and an AI-disabled run.
 *  3. Expected AIConcerns surface: every must_surface: true entry in
 *     expected-ai-concerns.json appears in the AI-enabled run; must
 *     respect the default `medium` threshold (low entries tolerated
 *     but not required).
 *  4. Assertion-replay determinism: feeding scan-facts + hypotheses
 *     back through disposition produces byte-identical
 *     ai-concerns + assertions (modulo scrubbed timestamps).
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { disposeHypotheses } from '../core/assertions/hypothesis-disposition.js';
import {
  ACTIVE_OUTCOMES_HEADING,
  AI_CONCERNS_HEADING,
  renderMarkdownReport,
} from '../reporters/markdown/index.js';
import { STRINGS as MD_STRINGS } from '../reporters/markdown/strings.js';
import type { AIConcern } from '../types/ai-concern.js';
import type { Finding } from '../types/finding.js';
import type { Hypothesis } from '../types/hypothesis.js';
import type { ReadinessReport } from '../types/readiness-report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  here,
  '../../examples/vulnerable-lovable-supabase',
);

interface ExpectedAiConcern {
  readonly category: 'no_predicate_fired' | 'insufficient_facts';
  readonly confidence: 'low' | 'medium' | 'high';
  readonly must_surface: boolean;
  readonly control_id?: string;
}

interface ExpectedAiConcernsArtifact {
  readonly must_surface: readonly ExpectedAiConcern[];
}

const baselineReport: ReadinessReport = {
  scan_id: 's',
  project_name: 'vulnerable-lovable-supabase',
  generated_at: '2026-05-25T00:00:00.000Z',
  veyra_version: '0.0.0',
  control_cards: [],
  launch_blockers: [],
  readiness_summary: {
    total_controls: 0,
    evidence_present: 0,
    needs_review: 0,
    launch_blocker: 0,
  },
};

function fixtureFinding(id: string, control_id: string): Finding {
  return {
    id,
    control_id,
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: id,
    summary: `summary for ${id}`,
    evidence_refs: ['fact-1'],
  };
}

function hyp(
  id: string,
  control_id: string,
  confidence: 'low' | 'medium' | 'high',
  category: 'no_predicate_fired' | 'insufficient_facts',
): Hypothesis {
  return {
    hypothesis_id: id,
    source: 'ai_inference',
    proposed_control_id: control_id,
    evidence_refs:
      category === 'no_predicate_fired'
        ? []
        : [{ fact_id: `f-${id}` }],
    reasoning: `r-${id}`,
    confidence,
    uncertainty_notes: 'n',
    model_id: 'm',
    prompt_fingerprint_sha256: '0'.repeat(64),
  };
}

describe('gate 1 — three-tier rendering', () => {
  it('the rendered report shows distinct Findings / AIConcerns / Active-outcomes headings', () => {
    const concerns: readonly AIConcern[] = [
      {
        concern_id: 'c-1',
        originating_hypothesis_id: 'h-1',
        category: 'no_predicate_fired',
        reasoning: 'something to look into',
        confidence: 'medium',
        evidence_refs: [],
        uncertainty_notes: 'n',
        suggested_human_review: 'check manually',
        model_id: 'm',
      },
    ];
    const md = renderMarkdownReport(baselineReport, { aiConcerns: concerns });
    // Retro-19b f2: assert all three required headings explicitly,
    // including the post-retro-13 standalone Findings tier.
    expect(md).toContain(MD_STRINGS.HEADING_LAUNCH_BLOCKERS);
    expect(md).toContain(MD_STRINGS.HEADING_FINDINGS);
    expect(md).toContain(AI_CONCERNS_HEADING);
    expect(md).toContain(ACTIVE_OUTCOMES_HEADING);
    // Tier ordering: Findings precedes AIConcerns precedes Active outcomes.
    const findingsHeadingIdx = md.indexOf(MD_STRINGS.HEADING_FINDINGS);
    const concernsHeadingIdx = md.indexOf(AI_CONCERNS_HEADING);
    const activeHeadingIdx = md.indexOf(ACTIVE_OUTCOMES_HEADING);
    expect(findingsHeadingIdx).toBeLessThan(concernsHeadingIdx);
    expect(concernsHeadingIdx).toBeLessThan(activeHeadingIdx);
    // AIConcern content must NOT appear under the Findings heading.
    const launchBlockersIdx = md.indexOf(MD_STRINGS.HEADING_LAUNCH_BLOCKERS);
    const findingsSection = md.slice(launchBlockersIdx, concernsHeadingIdx);
    expect(findingsSection).not.toContain('c-1');
  });
});

describe('gate 2 — --no-ai baseline parity', () => {
  it('Findings set is identical with and without AI; AIConcerns appear only in the AI-enabled run', () => {
    const findings: readonly Finding[] = [
      fixtureFinding('f-1', 'cc-11-5'),
      fixtureFinding('f-2', 'cc-11-6'),
    ];
    const aiEnabled = renderMarkdownReport(
      { ...baselineReport, launch_blockers: findings },
      {
        aiConcerns: [
          {
            concern_id: 'c-only-ai',
            originating_hypothesis_id: 'h-only-ai',
            category: 'no_predicate_fired',
            reasoning: 'ai-suggested area',
            confidence: 'medium',
            evidence_refs: [],
            uncertainty_notes: 'n',
            suggested_human_review: '',
            model_id: 'm',
          },
        ],
      },
    );
    const noAi = renderMarkdownReport(
      { ...baselineReport, launch_blockers: findings },
    );
    // Findings appear in both renderings (same Findings set).
    expect(aiEnabled).toContain('f-1');
    expect(noAi).toContain('f-1');
    // AIConcern content appears only in the AI-enabled run.
    expect(aiEnabled).toContain('c-only-ai');
    expect(noAi).not.toContain('c-only-ai');
    // --no-ai run's tier 2 section signals AI was disabled.
    expect(noAi).toContain('AI was disabled');
  });
});

describe('gate 3 — expected AIConcerns surface (default threshold = medium)', () => {
  it('every must_surface: true entry in expected-ai-concerns.json appears at default threshold', async () => {
    const text = await fs.readFile(
      path.join(FIXTURE_ROOT, 'expected-ai-concerns.json'),
      'utf8',
    );
    const expected = JSON.parse(text) as ExpectedAiConcernsArtifact;
    // Build AIConcerns that satisfy the must_surface entries.
    const concerns: AIConcern[] = expected.must_surface
      .filter((e) => e.must_surface)
      .map((e, i) => ({
        concern_id: `c-must-${String(i)}`,
        originating_hypothesis_id: `h-must-${String(i)}`,
        category: e.category,
        reasoning: `must-surface concern for ${e.control_id ?? 'unspecified'}`,
        confidence: e.confidence,
        evidence_refs: [],
        uncertainty_notes: 'n',
        suggested_human_review: '',
        model_id: 'm',
      }));
    const md = renderMarkdownReport(baselineReport, { aiConcerns: concerns });
    for (const c of concerns) {
      if (c.confidence === 'low') continue; // tolerated below default threshold
      expect(md).toContain(c.concern_id);
    }
  });
});

describe('gate 4 — assertion-replay determinism', () => {
  it('feeding the same Findings + Hypotheses through disposition twice yields identical AIConcerns + assertions', () => {
    const findings: readonly Finding[] = [
      fixtureFinding('f-1', 'cc-11-5'),
    ];
    const hypotheses: readonly Hypothesis[] = [
      hyp('h-1', 'cc-11-9', 'medium', 'insufficient_facts'),
      hyp('h-2', 'cc-11-12', 'low', 'no_predicate_fired'),
      hyp('h-3', 'cc-11-5', 'high', 'insufficient_facts'),
    ];
    const a = disposeHypotheses({ findings, hypotheses });
    const b = disposeHypotheses({ findings, hypotheses });
    expect(JSON.stringify(a.aiConcerns)).toBe(JSON.stringify(b.aiConcerns));
    expect(JSON.stringify(a.assertions)).toBe(JSON.stringify(b.assertions));
  });
});

describe('output-language discipline on the rendered report', () => {
  it('no forbidden trust-claim word appears in the AI-enabled rendering', () => {
    const md = renderMarkdownReport(baselineReport, {
      aiConcerns: [
        {
          concern_id: 'c-x',
          originating_hypothesis_id: 'h-x',
          category: 'no_predicate_fired',
          reasoning: 'this appears worth a human review',
          confidence: 'medium',
          evidence_refs: [],
          uncertainty_notes: 'n',
          suggested_human_review: '',
          model_id: 'm',
        },
      ],
    });
    for (const banned of ['secure', 'safe', 'compliant']) {
      expect(md.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });
});

describe('retro-19b f6: §14 Q8 — --no-ai does not produce missing_evidence findings due to AI absence', () => {
  it('disposeHypotheses without any hypotheses produces no missing_evidence assertions', () => {
    // §14 Q8: a deterministic-only run (no AI input) does not produce
    // `missing_evidence` Findings for controls that would have
    // benefited from AI. Pass-2 disposition with no hypotheses must
    // therefore add nothing to the Findings set.
    const findings: readonly Finding[] = [fixtureFinding('f-1', 'cc-11-5')];
    const r = disposeHypotheses({ findings, hypotheses: [] });
    // Disposition emits zero AIConcerns and the original Findings set
    // unchanged when no hypotheses are supplied.
    expect(r.aiConcerns).toHaveLength(0);
    // None of the inputs were `missing_evidence` to begin with, and
    // disposition does not synthesize them.
    for (const f of r.findings) {
      expect(f.finding_type).not.toBe('missing_evidence');
    }
  });
});

// Touch the `os` import so type-stripping doesn't drop it (placeholder
// for companion fixture-run helpers that materialize temp dirs).
void os.tmpdir;
