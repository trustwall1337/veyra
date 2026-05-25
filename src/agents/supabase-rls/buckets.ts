/**
 * Bucket-detection path. Per step 09 + revision: bucket state is NOT in
 * schema.sql; we read it from the Supabase MCP-derived
 * `storage-buckets.json` artifact (step 16). Without that artifact,
 * cc-11-12 must surface as `coverage_gap` — never silent absence.
 */

import { promises as fs } from 'node:fs';

import type { Finding } from '../../types/finding.js';

import type { BucketRecord } from './types.js';

interface BucketsArtifact {
  readonly buckets?: readonly BucketRecord[];
}

export interface BucketScanResult {
  readonly findings: readonly Finding[];
  readonly artifact_present: boolean;
}

export async function loadBucketsArtifact(
  artifactPath: string | undefined,
): Promise<BucketRecord[] | undefined> {
  if (artifactPath === undefined) return undefined;
  try {
    const text = await fs.readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(text) as BucketsArtifact;
    return [...(parsed.buckets ?? [])];
  } catch {
    return undefined;
  }
}

export function evaluateBuckets(
  buckets: BucketRecord[] | undefined,
): BucketScanResult {
  if (buckets === undefined) {
    return {
      artifact_present: false,
      findings: [
        {
          id: 'cc-11-12-coverage-gap',
          control_id: 'cc-11-12',
          finding_type: 'coverage_gap',
          evidence_strength: 'low',
          reproducibility: 'manual_review_required',
          review_action: 'review_before_launch',
          blast_radius: 'private_files',
          title: 'Storage bucket state was not checked',
          summary:
            'Supabase MCP is not configured; storage bucket public/private state was not checked. Negative tests should be added once `--supabase-mcp <project_ref>` is set.',
          evidence_refs: [],
        },
      ],
    };
  }

  const findings: Finding[] = [];
  for (const b of buckets) {
    if (!b.public) continue;
    const anonSelect = (b.policies ?? []).find(
      (p) =>
        p.role.toLowerCase() === 'anon' &&
        p.operation.toUpperCase() === 'SELECT',
    );
    if (anonSelect === undefined) continue;
    findings.push({
      id: `cc-11-12-${b.id}`,
      control_id: 'cc-11-12',
      finding_type: 'likely_issue',
      evidence_strength: 'high',
      reproducibility: 'mcp_context',
      review_action: 'fix_before_launch',
      blast_radius: 'private_files',
      title: `Public storage bucket "${b.name}" with anonymous SELECT policy`,
      summary: `Bucket "${b.name}" is public and grants SELECT to the anon role (policy "${anonSelect.name}"). This appears launch-blocking; needs human review. Regex heuristic — complex bucket policies may be missed.`,
      evidence_refs: [],
    });
  }
  return { artifact_present: true, findings };
}
