import type { GitleaksRunner } from '../../scanners/gitleaks/types.js';
import type { OsvRunner } from '../../scanners/osv/types.js';
import type { SemgrepRunner } from '../../scanners/semgrep/types.js';
import type { ScannerId } from '../../types/identity.js';
import type { ScanFact } from '../../types/scan-fact.js';

/**
 * Per-scanner outcome the tool-runner records into the
 * `scanner_findings` artifact.
 *
 *  - `ok`            — scanner ran to completion (zero or more findings)
 *  - `not_installed` — the scanner binary was not on PATH
 *  - `error`         — scanner ran but the adapter returned a typed
 *                      error (parse failure, non-zero exit, timeout)
 */
export type ScannerStatus = 'ok' | 'not_installed' | 'error';

/**
 * Scanner-agnostic finding shape the report agent (step 14) reads. Per
 * `FPP §2A` extensibility rules, this shape stays uniform across
 * scanners — adding a fourth scanner does not require changing the
 * report agent.
 */
export interface NormalizedScannerFinding {
  /** Scanner-native rule id (e.g. gitleaks rule, OSV id, semgrep rule). */
  readonly ruleId: string;
  /** Human-readable one-line summary from the scanner. */
  readonly title: string;
  /** File the finding points to (omitted for non-file-bound findings). */
  readonly filePath?: string;
  /** Source line, 1-indexed (omitted when the scanner reports no line). */
  readonly line?: number;
  /** Scanner-reported severity string, free-form (omitted if absent). */
  readonly severity?: string;
}

export interface ScannerSection {
  readonly scannerId: ScannerId;
  readonly status: ScannerStatus;
  readonly findings: readonly NormalizedScannerFinding[];
  /**
   * Last segment of the scanner's stderr, after secret-pattern redaction.
   * Persisted for auditability per step 08 Done-When. Omitted when stderr
   * was empty.
   */
  readonly stderrTail?: string;
  /**
   * One-line message describing why this section is `not_installed` /
   * `error`. Omitted when the scanner ran cleanly.
   */
  readonly errorSummary?: string;
}

export interface ToolRunnerInput {
  /**
   * Lockfile path passed to the OSV adapter. When absent the OSV section
   * is recorded as `error` with a `coverage_gap` finding — the adapter
   * refuses to traverse the project file system on its own (step 06).
   */
  readonly lockfilePath?: string;
  /**
   * Directory of Semgrep rules to load (defaults to the repo-bundled
   * `rules/` dir at orchestrator wiring time). When absent the Semgrep
   * section is recorded as `error`.
   */
  readonly rulesPath?: string;
  /**
   * Test seam. Production code path passes no `runners` and the agent
   * falls back to the default `node:child_process.spawn`-based runner.
   * Tests inject fakes that bypass real subprocesses.
   */
  readonly runners?: {
    readonly gitleaks?: GitleaksRunner;
    readonly osv?: OsvRunner;
    readonly semgrep?: SemgrepRunner;
  };
}

/**
 * Output shape after the 08b migration (AI-shape revision §9 Option B):
 * tool-runner aggregates `ScanFact[]` from each scanner adapter and
 * persists them as `scan-facts.json`. The per-scanner section list is
 * preserved for the coverage_gap path (status === 'not_installed' /
 * 'error') and for stderr persistence, but findings are no longer
 * shaped here — assertion predicates in 09b–12b emit findings from
 * `ScanFact[]`.
 */
export interface ToolRunnerOutput {
  readonly scannerSections: readonly ScannerSection[];
  readonly scanFacts: readonly ScanFact[];
}
