import type {
  AllowedAction,
  ValidationPolicy,
} from '../../types/validation-policy.js';

import type { ArtifactState } from './artifact-state.js';

/**
 * Required-evidence ledger (Phase 3 / Agentic Veyra, PLAN §K). A checked-in
 * literal table — NOT derived from any catalog — that says which evidence a
 * scan must gather before its baseline is satisfied. The loop evaluates
 * `baselineSatisfied` at `done`; a premature `done` with unmet rows records an
 * `early_done` and the floor (Step 35) emits one `coverage_gap` per missing
 * row. The AI cannot suppress the baseline by terminating early.
 *
 * Deliberate-row-addition rule (§K, r2 finding 7): the table is a literal and
 * {@link LEDGER_ROW_COUNT} is CI-pinned, so adding/removing a row trips the
 * row-count test in `required-evidence-ledger.test.ts` (and Step 41).
 *
 * Mode parameterization is driven by `allowed_actions`, never by `policy.mode`
 * (CLAUDE.md §Validation policy): the two Mode-B rows are included exactly when
 * the policy permits the active probe/actor actions.
 */

/** Tool ids the ledger predicates reference; Step 33 registers exactly these. */
export const LEDGER_TOOL_IDS = {
  // These ids must match the tool ids registered in Step 33
  // (`src/cli/tool-registration.ts`). The Supabase schema/storage reads use the
  // semantic-renamed MCP tool ids.
  readSchema: 'read-schema-meta',
  readStorageMetadata: 'read-storage-meta',
  runGitleaks: 'run-gitleaks',
  runOsv: 'run-osv',
  runSemgrep: 'run-semgrep',
  readCode: 'read-code',
  establishActorSession: 'establish-actor-session',
} as const;

/** Artifact basenames the ledger predicates check. */
export const LEDGER_ARTIFACTS = {
  databaseMetadata: 'database-metadata.json',
  actorSessions: 'actor-sessions.json',
  httpWriteRegistry: 'http-write-registry.json',
} as const;

/**
 * CI-pinned row counts. A test asserts a `read_only_evidence` policy yields
 * exactly `mode_a` rows and an active policy yields `mode_a + mode_b_add`.
 */
export const LEDGER_ROW_COUNT = { mode_a: 6, mode_b_add: 2 } as const;

/** One ledger row. */
export interface LedgerRow {
  readonly baseline_item_id: string;
  readonly gap_control_id: string;
  readonly satisfied_by: (state: ArtifactState) => boolean;
}

/** A missing ledger item → a floor `coverage_gap` (Step 35). */
export interface LedgerGap {
  readonly baseline_item_id: string;
  readonly gap_control_id: string;
}

const MODE_A_ROWS: readonly LedgerRow[] = [
  {
    baseline_item_id: 'schema_meta_read',
    gap_control_id: 'cc-11-5',
    satisfied_by: (s) =>
      s.hasArtifact(LEDGER_ARTIFACTS.databaseMetadata) &&
      s.toolSucceeded(LEDGER_TOOL_IDS.readSchema),
  },
  {
    baseline_item_id: 'storage_meta_read',
    gap_control_id: 'cc-11-6',
    // If no StorageMetadataSource is registered the tool never succeeds →
    // false → coverage_gap, never a silent absence (§K).
    satisfied_by: (s) => s.toolSucceeded(LEDGER_TOOL_IDS.readStorageMetadata),
  },
  {
    baseline_item_id: 'scanner_secrets_run',
    gap_control_id: 'cc-11-7',
    satisfied_by: (s) => s.toolSucceeded(LEDGER_TOOL_IDS.runGitleaks),
  },
  {
    baseline_item_id: 'scanner_deps_run',
    gap_control_id: 'cc-11-8',
    satisfied_by: (s) => s.toolSucceeded(LEDGER_TOOL_IDS.runOsv),
  },
  {
    baseline_item_id: 'scanner_sast_run',
    gap_control_id: 'cc-11-9',
    satisfied_by: (s) => s.toolSucceeded(LEDGER_TOOL_IDS.runSemgrep),
  },
  {
    baseline_item_id: 'declared_surface_read',
    gap_control_id: 'cc-11-1',
    satisfied_by: (s) => s.toolSucceeded(LEDGER_TOOL_IDS.readCode),
  },
];

const MODE_B_ADD_ROWS: readonly LedgerRow[] = [
  {
    baseline_item_id: 'actor_session_established',
    gap_control_id: 'cc-11-10',
    satisfied_by: (s) =>
      s.hasArtifact(LEDGER_ARTIFACTS.actorSessions) &&
      s.toolSucceeded(LEDGER_TOOL_IDS.establishActorSession),
  },
  {
    baseline_item_id: 'declared_probe_attempted',
    gap_control_id: 'cc-11-11',
    satisfied_by: (s) =>
      s.hasArtifact(LEDGER_ARTIFACTS.httpWriteRegistry) &&
      s.probeAttemptCount() >= 1,
  },
];

// Active actions whose presence pulls in the two Mode-B rows. Checked against
// `allowed_actions`, not `policy.mode`.
const ACTIVE_PROBE_ACTIONS: readonly AllowedAction[] = [
  'call_api_with_test_identity',
  'create_synthetic_user',
];

/** Build the ledger row set for a policy (read-only = 6, active = 6 + 2). */
export class RequiredEvidenceLedger {
  private readonly rows: readonly LedgerRow[];

  constructor(policy: ValidationPolicy) {
    const includesActive = ACTIVE_PROBE_ACTIONS.some((a) =>
      policy.allowed_actions.has(a),
    );
    this.rows = includesActive
      ? [...MODE_A_ROWS, ...MODE_B_ADD_ROWS]
      : MODE_A_ROWS;
  }

  rowCount(): number {
    return this.rows.length;
  }

  baselineSatisfied(state: ArtifactState): boolean {
    return this.rows.every((row) => row.satisfied_by(state));
  }

  missing(state: ArtifactState): readonly LedgerGap[] {
    return this.rows
      .filter((row) => !row.satisfied_by(state))
      .map((row) => ({
        baseline_item_id: row.baseline_item_id,
        gap_control_id: row.gap_control_id,
      }));
  }
}
