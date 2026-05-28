import type { Finding } from '../../types/finding.js';

import type { CleanupProof } from './http-write-registry.js';

/**
 * Produce a `cleanup_failed` launch-blocker Finding from a cleanup proof
 * (codex p3-r1-003: kept SEPARATE from `http-write-registry.ts` so the
 * `executeWriteWithRegistry` module is Finding-free. A registered probe tool
 * that imports the wrapper therefore does NOT make `Finding` reachable from a
 * tool entrypoint — preserving Step 35's import-graph guarantee).
 *
 * This file is reachable from the deterministic floor / reporter, never from a
 * tool's `invoke`.
 */
export function cleanupFailedFinding(proof: CleanupProof): Finding {
  return {
    id: `cleanup-failed-${String(proof.attempted)}-${String(proof.residual_count)}`,
    control_id: 'cc-cleanup-veyra-created-data',
    finding_type: 'confirmed_issue',
    evidence_strength: 'high',
    reproducibility: 'tool_output',
    review_action: 'fix_before_launch',
    blast_radius: 'user_data',
    title: `Sandbox cleanup left ${String(proof.residual_count)} residual write(s)`,
    summary:
      `${String(proof.residual_count)} Veyra-created sandbox write(s) could not be reverted and appear launch-blocking; needs human review.`,
    evidence_refs: proof.failures.map((f) => f.entry.id),
  };
}
