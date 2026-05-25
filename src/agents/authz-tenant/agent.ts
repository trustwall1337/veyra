/**
 * authz-tenant agent — Pass-1 assertion predicate over ScanFact[].
 *
 * Per retro-11b: reads `scan-facts.json` and dispatches to the
 * deterministic predicate functions in `./predicates.ts`. The legacy
 * file-walking heuristics path (heuristics.ts) is no longer the
 * runtime path — heuristics.ts now serves as a reference for future
 * Pass-2 hypothesis attachment, not the Pass-1 deciding code.
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
  authzCoverageGaps,
  predicateClientTenantId,
  predicateCrossTenantWriteRisk,
  predicateDirectObjectAccess,
} from './predicates.js';
import type { AuthzTenantInput, AuthzTenantOutput } from './types.js';

const METADATA: AgentMetadata = {
  id: 'authz-tenant',
  version: '0.2.0',
  declared_dependencies: ['scan-facts.json'],
};

const UNCERTAINTY_NOTE =
  'static authz detection over ScanFact[]; server-side authorization via SSR/middleware or row-level policies may exist but not be detected';

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
  // Retro-11b f4: emit a coverage_gap per affected control when the
  // upstream scan-facts artifact is missing. Each predicate gets its
  // own gap so the report attributes the absence to the right control.
  const make = (controlId: string): Finding => ({
    id: `${controlId}-coverage-gap-no-scan-facts`,
    control_id: controlId,
    finding_type: 'coverage_gap',
    evidence_strength: 'low',
    reproducibility: 'manual_review_required',
    review_action: 'review_before_launch',
    blast_radius: 'tenant_data',
    title: `${controlId} predicate had no facts to evaluate`,
    summary: `scan-facts.json was not produced for this scan, so the Pass-1 predicate could not evaluate ${controlId}. Negative tests should be added once the artifact is available. ${UNCERTAINTY_NOTE}.`,
    evidence_refs: [],
  });
  return [make('cc-11-3'), make('cc-11-4'), make('cc-11-9')];
}

export function createAuthzTenantAgent(): VeyraAgent<
  AuthzTenantInput,
  AuthzTenantOutput
> {
  return {
    metadata: METADATA,
    async run(
      input: AuthzTenantInput,
      _context: AgentExecutionContext,
    ): Promise<AgentResult<AuthzTenantOutput>> {
      // Back-compat: pre-08b code may still pass scannerFindingsArtifactPath.
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
      findings.push(...predicateDirectObjectAccess(facts));
      findings.push(...predicateClientTenantId(facts));
      findings.push(...predicateCrossTenantWriteRisk(facts));
      findings.push(...authzCoverageGaps(facts));

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
