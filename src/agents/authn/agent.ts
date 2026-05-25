/**
 * authn agent — Pass-1 assertion predicate over ScanFact[].
 *
 * Per retro-10b: reads `scan-facts.json` and dispatches to the
 * deterministic predicate functions in `./predicates.ts`. The legacy
 * file-walking heuristics path (heuristics.ts) is retained as a regex
 * reference for future Pass-2 hypothesis attachment.
 *
 * Constraint 10: predicates accept only `readonly ScanFact[]`; this
 * agent never reads `hypotheses.json`.
 */

import { promises as fs } from 'node:fs';

import type {
  AgentExecutionContext,
  AgentMetadata,
  AgentResult,
  VeyraAgent,
} from '../../types/agent.js';
import type { Finding } from '../../types/finding.js';
import type { ScanFact } from '../../types/scan-fact.js';

import {
  authnCoverageGaps,
  predicateAdminWithoutServerCheck,
  predicateClientOnlyProtection,
} from './predicates.js';
import type { AuthnInput, AuthnOutput } from './types.js';

const METADATA: AgentMetadata = {
  id: 'authn',
  version: '0.2.0',
  declared_dependencies: ['scan-facts.json'],
};

const UNCERTAINTY_NOTE =
  'static authn detection over ScanFact[]; server-side checks via SSR/middleware or framework conventions may exist but not be detected';

interface ScanFactsArtifact {
  readonly scan_facts?: readonly ScanFact[];
}

async function readScanFacts(
  artifactPath: string | undefined,
): Promise<readonly ScanFact[] | undefined> {
  if (artifactPath === undefined) return undefined;
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as ScanFactsArtifact;
    return parsed.scan_facts ?? [];
  } catch {
    return undefined;
  }
}

function missingScanFactsCoverageGap(): readonly Finding[] {
  // Retro-10b: emit a coverage_gap per affected control when the
  // upstream scan-facts artifact is missing. Predicates can't run.
  const make = (
    controlId: 'cc-11-1' | 'cc-11-2',
    radius: 'user_data' | 'admin_access',
  ): Finding => ({
    id: `${controlId}-coverage-gap-no-scan-facts`,
    control_id: controlId,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius: radius,
    title: `${controlId} predicate had no facts to evaluate`,
    summary: `scan-facts.json was not produced for this scan, so the Pass-1 predicate could not evaluate ${controlId}. Negative tests should be added once the artifact is available. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
  });
  return [make('cc-11-1', 'user_data'), make('cc-11-2', 'admin_access')];
}

export function createAuthnAgent(): VeyraAgent<AuthnInput, AuthnOutput> {
  return {
    metadata: METADATA,
    async run(
      input: AuthnInput,
      _context: AgentExecutionContext,
    ): Promise<AgentResult<AuthnOutput>> {
      const factsPath =
        input.scanFactsArtifactPath ?? input.scannerFindingsArtifactPath;
      const facts = await readScanFacts(factsPath);

      if (facts === undefined) {
        const gaps = missingScanFactsCoverageGap();
        return {
          status: 'completed',
          artifacts: [],
          findings: [...gaps],
          warnings: [],
          output: {
            findingsCount: gaps.length,
            factsConsumed: 0,
          },
        };
      }

      const findings: Finding[] = [];
      findings.push(...predicateClientOnlyProtection(facts));
      findings.push(...predicateAdminWithoutServerCheck(facts));
      findings.push(...authnCoverageGaps(facts));

      return {
        status: 'completed',
        artifacts: [],
        findings,
        warnings: [],
        output: {
          findingsCount: findings.length,
          factsConsumed: facts.length,
        },
      };
    },
  };
}
