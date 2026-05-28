import type { ClaimRecord } from '../../types/claim-record.js';
import type { Finding } from '../../types/finding.js';

/**
 * Deterministic narrative-author (Phase 3 / Step 36). Lands the structural
 * surface: take findings + ledger baseline ids and produce a list of
 * {@link ClaimRecord}s. AI authoring is layered over this same shape later
 * (the AI tool emits the same `ClaimRecord[]` it does here, with richer
 * `template_params` and the same linter contract). Free-form prose is never
 * emitted from this surface.
 */

export interface ComposeClaimsInput {
  readonly findings: readonly Finding[];
  /**
   * The artifact refs available for citation (e.g. artifact basenames, fact
   * ids). Used to populate `supporting_artifact_refs`; the linter rejects an
   * empty or unresolvable set.
   */
  readonly artifact_refs: readonly string[];
}

/**
 * Compose a deterministic `ClaimRecord[]` from the floor's findings. Each
 * finding becomes one record. The output passes the claim-linter against a
 * context built from these same findings + artifact refs.
 */
export function composeClaimsFromFindings(
  input: ComposeClaimsInput,
): readonly ClaimRecord[] {
  const claims: ClaimRecord[] = [];
  for (const finding of input.findings) {
    const claim = claimForFinding(finding, input.artifact_refs);
    if (claim !== undefined) claims.push(claim);
  }
  return claims;
}

function claimForFinding(
  finding: Finding,
  artifact_refs: readonly string[],
): ClaimRecord | undefined {
  // Pick a `supporting_artifact_refs` set: the finding's own `evidence_refs`
  // (resolvable via `artifact_refs`) plus, as a deterministic floor, the
  // finding's id itself (always resolvable as a predicate output).
  const supportSet = new Set<string>();
  for (const ref of finding.evidence_refs) {
    if (artifact_refs.includes(ref)) supportSet.add(ref);
  }
  supportSet.add(finding.id);
  const support = [...supportSet];

  switch (finding.finding_type) {
    case 'coverage_gap':
      return {
        claim_type: 'baseline_unmet',
        predicate_kind: 'coverage_gap',
        subject_id: finding.control_id,
        predicate_output_id: finding.id,
        supporting_artifact_refs: support,
        template_params: { baseline_item_id: finding.title },
      };
    case 'informational':
      return {
        claim_type: 'informational',
        predicate_kind: 'tool_succeeded',
        subject_id: finding.control_id,
        predicate_output_id: finding.id,
        supporting_artifact_refs: support,
        template_params: { tool_id: finding.title },
      };
    case 'likely_issue':
    case 'confirmed_issue':
      // Default to the privileged-key shape unless callers supply a richer
      // mapping; this is a deterministic placeholder pending the per-predicate
      // wiring in Step 39 / Step 35 predicate relocation.
      return {
        claim_type: 'likely_issue',
        predicate_kind: 'privileged_key',
        subject_id: finding.control_id,
        predicate_output_id: finding.id,
        supporting_artifact_refs: support,
        template_params: { location: finding.title },
      };
    default:
      return undefined;
  }
}
