import { describe, expect, it } from 'vitest';

import type { AIConcern } from '../../../types/ai-concern.js';
import type { ReadinessReport } from '../../../types/readiness-report.js';

import {
  ACTIVE_OUTCOMES_HEADING,
  AI_CONCERNS_HEADING,
  renderMarkdownReport,
  type AiConcernThreshold,
} from '../index.js';

const report: ReadinessReport = {
  scan_id: 's',
  project_name: 'demo',
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

function concern(overrides: Partial<AIConcern>): AIConcern {
  return {
    concern_id: 'c1',
    originating_hypothesis_id: 'h1',
    category: 'no_predicate_fired',
    reasoning: 'reasoning text',
    confidence: 'medium',
    evidence_refs: [],
    uncertainty_notes: '',
    suggested_human_review: '',
    model_id: 'm',
    ...overrides,
  };
}

describe('three-tier rendering — section presence', () => {
  it('all three tier headings appear in the rendered markdown when AI is enabled', () => {
    const md = renderMarkdownReport(report, { aiConcerns: [] });
    expect(md).toContain(AI_CONCERNS_HEADING);
    expect(md).toContain(ACTIVE_OUTCOMES_HEADING);
    // Findings section is the existing "items that appear launch-blocking" + control cards.
    expect(md).toContain('appear launch-blocking');
  });

  it('--no-ai path: tier 2 OMITTED from body; Sources carries the disabled-AI note', () => {
    const md = renderMarkdownReport(report); // no aiConcerns option = disabled
    // Tier 2 must NOT appear in the body.
    expect(md).not.toContain(AI_CONCERNS_HEADING);
    // Sources carries the disabled-AI note.
    expect(md).toContain('## Sources and scanner metadata');
    expect(md).toContain('AI was disabled for this scan');
  });

  it('AI-enabled path renders Sources AI usage when aiUsage is supplied', () => {
    const md = renderMarkdownReport(report, {
      aiConcerns: [],
      aiUsage: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        call_count: 3,
        cache_hit_ratio: 0.75,
      },
    });
    expect(md).toContain('## Sources and scanner metadata');
    expect(md).toContain('provider: `anthropic`');
    expect(md).toContain('model: `claude-sonnet-4-6`');
    expect(md).toContain('ai_call_count: 3');
    expect(md).toContain('cache_hit_ratio: 0.750');
    expect(md).not.toContain('AI was disabled');
  });
});

describe('three-tier rendering — --ai-concern-threshold filter', () => {
  const concerns: readonly AIConcern[] = [
    concern({ concern_id: 'low-1', confidence: 'low', reasoning: 'low-r' }),
    concern({ concern_id: 'med-1', confidence: 'medium', reasoning: 'med-r' }),
    concern({ concern_id: 'high-1', confidence: 'high', reasoning: 'high-r' }),
  ];

  it('threshold=low renders all three', () => {
    const md = renderMarkdownReport(report, {
      aiConcerns: concerns,
      aiConcernThreshold: 'low',
    });
    expect(md).toContain('low-1');
    expect(md).toContain('med-1');
    expect(md).toContain('high-1');
  });

  it('threshold=medium (default) hides low, renders medium and high', () => {
    const md = renderMarkdownReport(report, { aiConcerns: concerns });
    expect(md).not.toContain('low-1');
    expect(md).toContain('med-1');
    expect(md).toContain('high-1');
  });

  it('threshold=high renders only high', () => {
    const md = renderMarkdownReport(report, {
      aiConcerns: concerns,
      aiConcernThreshold: 'high' as AiConcernThreshold,
    });
    expect(md).not.toContain('low-1');
    expect(md).not.toContain('med-1');
    expect(md).toContain('high-1');
  });
});

describe('three-tier rendering — vocabulary discipline', () => {
  it('no forbidden trust-claim word appears in the rendered markdown', () => {
    const md = renderMarkdownReport(report, {
      aiConcerns: [
        concern({
          reasoning: 'this appears worth a review by a human',
        }),
      ],
    });
    for (const banned of ['secure', 'safe', 'compliant']) {
      expect(md.toLowerCase()).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });
});
