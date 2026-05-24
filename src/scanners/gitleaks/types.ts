import type {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';

/** Input to {@link runGitleaks}. */
export interface GitleaksInput {
  /** Absolute path to the project root to scan. */
  readonly projectPath: string;
  /** Override default subprocess timeout (60s). */
  readonly timeoutMs?: number;
}

/**
 * Normalized, scrubbed gitleaks finding. Raw `Match` and `Secret` fields from
 * gitleaks JSON are intentionally NOT present on this shape — they are
 * dropped at parse time so they cannot leak through downstream code paths.
 * Every string field below also passes through {@link redactSecrets}, so even
 * if gitleaks failed to honor `--redact`, the value reaching this shape is
 * scrubbed.
 */
export interface GitleaksFinding {
  readonly ruleId: string;
  readonly filePath: string;
  readonly line: number;
  readonly description: string;
  readonly fingerprint: string;
}

/** Output of {@link runGitleaks} on a successful run. */
export interface GitleaksOutput {
  readonly findings: readonly GitleaksFinding[];
}

/** Union of every typed failure mode the adapter can return. */
export type GitleaksError =
  | ScannerNotInstalledError
  | ScannerOutputParseError
  | ScannerExecutionError;

/**
 * The raw subprocess result. The adapter parses `stdout` for findings;
 * `stderr` is captured per step 05 guardrails (auditability) but is not
 * part of the normalized output — the tool-runner agent in step 08 decides
 * whether to persist it.
 *
 * `exitCode === null` means the process did not exit normally (killed by
 * signal — typically the spawn `timeout` option). The adapter maps that to
 * `ScannerExecutionError` rather than treating it as a clean run.
 */
export interface GitleaksRunnerResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface GitleaksRunnerOptions {
  readonly timeoutMs: number;
}

/**
 * Pluggable subprocess shim. Tests inject a fake; the default implementation
 * shells out to the real `gitleaks` binary via `node:child_process.spawn`.
 *
 * Per CLAUDE.md §Architecture, the binary name is passed in by the caller —
 * the runner has no opinion about which scanner it's running.
 */
export type GitleaksRunner = (
  binary: string,
  args: readonly string[],
  opts: GitleaksRunnerOptions,
) => Promise<GitleaksRunnerResult>;
