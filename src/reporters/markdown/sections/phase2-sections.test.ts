import { describe, expect, it } from 'vitest';

import {
  renderActiveValidationSection,
  renderAiExplanationsSection,
  renderCleanupProofSection,
} from './phase2-sections.js';
import type { ActiveValidationResult } from '../../../types/scan-plan.js';
import type { CleanupProof } from '../../../agents/synthetic-data-manager/agent.js';
import type { AiEnrichment } from '../../../agents/ai-explainer/agent.js';

describe('renderActiveValidationSection', () => {
  it('renders the no-data branch when no results passed', () => {
    const text = renderActiveValidationSection({});
    expect(text).toContain('No active-validation tests were run');
  });

  it('groups results by outcome and includes the inconclusive guidance', () => {
    const results: ActiveValidationResult[] = [
      { test_id: 't1', control_id: 'cc-11-5', outcome: 'proven_allowed', evidence_refs: [], duration_ms: 100, synthetic_data_refs: [], assertion_details: {} },
      { test_id: 't2', control_id: 'cc-11-2', outcome: 'inconclusive', evidence_refs: [], duration_ms: 50, synthetic_data_refs: [], assertion_details: {} },
    ];
    const text = renderActiveValidationSection({ activeValidationResults: results });
    expect(text).toContain('proven_allowed (1)');
    expect(text).toContain('inconclusive (1)');
    expect(text).toContain('needs human review');
  });
});

describe('renderCleanupProofSection', () => {
  it('renders residual=0 success', () => {
    const proof: CleanupProof = {
      scan_id: 's-1',
      created_count: 3,
      deleted_count: 3,
      residual_count: 0,
      duration_ms: 1234,
      per_resource_log: [],
    };
    const text = renderCleanupProofSection({ cleanupProof: proof });
    expect(text).toContain('residual_count: 0');
  });

  it('flags residual > 0 as appears-launch-blocking', () => {
    const proof: CleanupProof = {
      scan_id: 's-1',
      created_count: 3,
      deleted_count: 1,
      residual_count: 2,
      duration_ms: 5678,
      per_resource_log: [],
    };
    const text = renderCleanupProofSection({ cleanupProof: proof });
    expect(text).toContain('residual_count: 2');
    expect(text).toContain('appears launch-blocking');
    expect(text).toContain('needs human review');
  });
});

describe('renderAiExplanationsSection', () => {
  it('renders the disabled branch when aiDisabled', () => {
    const text = renderAiExplanationsSection({ aiDisabled: true });
    expect(text).toContain('disabled for this scan');
  });

  it('respects aiConcernThreshold (medium hides low-confidence main; renders under audit subhead)', () => {
    const enrichments: AiEnrichment[] = [
      {
        finding_id: 'f-low',
        control_id: 'cc-11-1',
        explanation: 'low confidence detail',
        suggested_tests_refined: [],
        control_card_narrative: '',
        confidence: 'low',
        uncertainty_notes: '',
        model_id: 'm',
      },
      {
        finding_id: 'f-high',
        control_id: 'cc-11-5',
        explanation: 'high confidence detail',
        suggested_tests_refined: ['add cross-tenant test'],
        control_card_narrative: '',
        confidence: 'high',
        uncertainty_notes: '',
        model_id: 'm',
      },
    ];
    const text = renderAiExplanationsSection({
      aiEnrichments: enrichments,
      aiConcernThreshold: 'medium',
    });
    expect(text).toContain('cc-11-5 (confidence: high)');
    // Codex retro 2.12-below-threshold-ai-still-rendered: below-threshold
    // entries are NOT rendered in the report body. Only a count
    // referencing ai-enrichments.json + the --ai-concern-threshold
    // flag remains.
    expect(text).not.toContain('cc-11-1 (confidence: low)');
    expect(text).toContain('ai-enrichments.json');
    expect(text).toContain('--ai-concern-threshold');
  });

  it('low threshold renders everything in the main body', () => {
    const enrichments: AiEnrichment[] = [
      {
        finding_id: 'f-low',
        control_id: 'cc-11-1',
        explanation: 'low conf',
        suggested_tests_refined: [],
        control_card_narrative: '',
        confidence: 'low',
        uncertainty_notes: '',
        model_id: 'm',
      },
    ];
    const text = renderAiExplanationsSection({
      aiEnrichments: enrichments,
      aiConcernThreshold: 'low',
    });
    expect(text).toContain('cc-11-1 (confidence: low)');
    expect(text).not.toContain('Low-confidence AI suggestions');
  });
});
