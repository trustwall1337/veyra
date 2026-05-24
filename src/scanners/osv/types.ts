import type {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';

/** Input to {@link runOsv}. */
export interface OsvInput {
  /**
   * Absolute path to the lockfile to scan. The adapter passes this through
   * `--lockfile`; it does NOT scan recursively or traverse the project on
   * its own (step 06 Done-When: "refuses to traverse the project file
   * system on its own").
   */
  readonly lockfilePath: string;
  /** Override default subprocess timeout (60s). */
  readonly timeoutMs?: number;
}

/**
 * Compile-time-pinned defaults that match the step file's Done-When clause:
 * dependency findings are launch-readiness signals, not proof of
 * exploitability. The literal-type union also doubles as a guardrail
 * against drift — assigning `'confirmed_issue'` to `findingType` would
 * not type-check.
 */
export type OsvFindingType = 'likely_issue' | 'informational';
export type OsvEvidenceStrength = 'medium';
export type OsvReviewAction = 'review_before_launch';

/** Normalized OSV finding, one per (package, vulnerability) pair. */
export interface OsvFinding {
  /** Primary OSV id (e.g. `GHSA-...` or `CVE-...`). */
  readonly vulnerabilityId: string;
  /** Other ids the same advisory is published under. */
  readonly aliases: readonly string[];
  /** Package name as reported by osv-scanner. */
  readonly packageName: string;
  /** Pinned version that matches the advisory. */
  readonly packageVersion: string;
  /** Ecosystem (e.g. `npm`, `PyPI`). */
  readonly ecosystem: string;
  /** Short human-readable summary from the OSV record. */
  readonly summary: string;
  /** Severity string if osv-scanner reported one; absent otherwise. */
  readonly severity?: string;
  readonly findingType: OsvFindingType;
  readonly evidenceStrength: OsvEvidenceStrength;
  readonly reviewAction: OsvReviewAction;
}

/** Output of {@link runOsv} on a successful run. */
export interface OsvOutput {
  readonly findings: readonly OsvFinding[];
}

/** Union of every typed failure mode the adapter can return. */
export type OsvError =
  | ScannerNotInstalledError
  | ScannerOutputParseError
  | ScannerExecutionError;

/**
 * Raw subprocess result. The adapter parses `stdout` for findings;
 * `stderr` is captured for auditability but not part of the normalized
 * output — the tool-runner agent (step 08) decides whether to persist it.
 *
 * `exitCode === null` means the process did not exit normally (killed by
 * signal — typically the spawn `timeout` option firing SIGTERM). The
 * adapter maps that to `ScannerExecutionError` rather than treating it as
 * a clean run.
 */
export interface OsvRunnerResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface OsvRunnerOptions {
  readonly timeoutMs: number;
}

/**
 * Pluggable subprocess shim. Tests inject a fake; the default implementation
 * shells out to the real `osv-scanner` binary via `node:child_process.spawn`.
 */
export type OsvRunner = (
  binary: string,
  args: readonly string[],
  opts: OsvRunnerOptions,
) => Promise<OsvRunnerResult>;
