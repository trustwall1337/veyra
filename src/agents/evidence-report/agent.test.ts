import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentExecutionContext, AgentLogger } from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';
import { defaultReadOnlyEvidencePolicy } from '../../types/validation-policy.js';

import { composeReport, evidenceReportAgent } from './agent.js';
import { CONTROLS, findControl } from './controls.js';
import { computeReadiness } from './readiness.js';

function logger(): AgentLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function ctx(): Promise<AgentExecutionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyra-ev-'));
  return {
    scanId: 'scan-test',
    projectRoot: dir,
    artifactDir: dir,
    policy: defaultReadOnlyEvidencePolicy('local'),
    logger: logger(),
  };
}

function finding(overrides: Partial<Finding> & Pick<Finding, 'control_id'>): Finding {
  return {
    id: 'f-test',
    finding_type: 'likely_issue',
    evidence_strength: 'medium',
    reproducibility: 'static',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: 'test',
    summary: 'test summary',
    evidence_refs: [],
    ...overrides,
  };
}

describe('controls.ts catalog', () => {
  it('contains cc-11-1 through cc-11-12 exactly once each', () => {
    const ids = CONTROLS.map((c) => c.control_id);
    expect(new Set(ids).size).toBe(12);
    for (let i = 1; i <= 12; i += 1) {
      expect(ids).toContain(`cc-11-${String(i)}`);
    }
  });

  it('findControl resolves a known control id', () => {
    expect(findControl('cc-11-5')?.expected_behavior).toContain('ROW LEVEL SECURITY');
  });
});

describe('computeReadiness — explicit rules', () => {
  it('confirmed_issue + fix_before_launch → launch_blocker', () => {
    const status = computeReadiness({
      findings: [
        finding({
          control_id: 'cc-11-8',
          finding_type: 'confirmed_issue',
          review_action: 'fix_before_launch',
        }),
      ],
      evidence: [],
    });
    expect(status).toBe('launch_blocker');
  });

  it('likely_issue + high evidence_strength + fix_before_launch → launch_blocker', () => {
    const status = computeReadiness({
      findings: [
        finding({
          control_id: 'cc-11-5',
          finding_type: 'likely_issue',
          evidence_strength: 'high',
          review_action: 'fix_before_launch',
        }),
      ],
      evidence: [],
    });
    expect(status).toBe('launch_blocker');
  });

  it('likely_issue + medium evidence_strength does NOT block', () => {
    const status = computeReadiness({
      findings: [
        finding({
          control_id: 'cc-11-3',
          finding_type: 'likely_issue',
          evidence_strength: 'medium',
          review_action: 'fix_before_launch',
        }),
      ],
      evidence: [],
    });
    expect(status).not.toBe('launch_blocker');
  });

  it('coverage_gap → needs_review', () => {
    const status = computeReadiness({
      findings: [
        finding({
          control_id: 'cc-11-12',
          finding_type: 'coverage_gap',
          review_action: 'review_before_launch',
        }),
      ],
      evidence: [],
    });
    expect(status).toBe('needs_review');
  });

  it('evidence present + no findings → evidence_present', () => {
    const status = computeReadiness({
      findings: [],
      evidence: [
        {
          id: 'e1',
          source: 'static_code',
          file: 'src/x.ts',
        },
      ],
    });
    expect(status).toBe('evidence_present');
  });
});

describe('composeReport — ReadinessReport assembly', () => {
  it('produces a control card for every catalog entry', () => {
    const composed = composeReport(
      { findings: [] },
      { scanId: 's', generatedAt: '2026-05-25T00:00:00Z' },
    );
    expect(composed.report.control_cards.length).toBe(CONTROLS.length);
  });

  it('launchBlockerCount reflects the count of launch_blocker cards', () => {
    const composed = composeReport(
      {
        findings: [
          finding({
            control_id: 'cc-11-5',
            finding_type: 'likely_issue',
            evidence_strength: 'high',
            review_action: 'fix_before_launch',
          }),
          finding({
            control_id: 'cc-11-8',
            finding_type: 'confirmed_issue',
            review_action: 'fix_before_launch',
          }),
        ],
      },
      { scanId: 's', generatedAt: '2026-05-25T00:00:00Z' },
    );
    expect(composed.launchBlockerCount).toBe(2);
    expect(composed.report.readiness_summary.launch_blocker).toBe(2);
  });
});

describe('evidenceReportAgent — artifact emission', () => {
  it('writes control-cards.json and readiness-report.json', async () => {
    const c = await ctx();
    const r = await evidenceReportAgent.run({ findings: [] }, c);
    expect(r.status).toBe('completed');
    const written = await fs.readdir(c.artifactDir);
    expect(written).toContain('control-cards.json');
    expect(written).toContain('readiness-report.json');
  });

  it('agent emits no new findings of its own', async () => {
    const c = await ctx();
    const r = await evidenceReportAgent.run(
      {
        findings: [finding({ control_id: 'cc-11-5' })],
      },
      c,
    );
    expect(r.findings).toEqual([]);
  });
});
