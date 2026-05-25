import type {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';
import type { ScanFact } from '../../types/scan-fact.js';

/** Input to {@link runGitleaks}. */
export interface GitleaksInput {
  /** Absolute path to the project root to scan. */
  readonly projectPath: string;
  /** Override default subprocess timeout (60s). */
  readonly timeoutMs?: number;
}

/**
 * Normalized, scrubbed gitleaks parser output. Raw `Secret` field from
 * gitleaks JSON is intentionally NOT present on this shape — it is
 * dropped at parse time so it cannot leak through downstream code paths.
 * `match` is the gitleaks-already-redacted `Match` field (under
 * `--redact` it is "REDACTED" or a partial form) — kept as audit
 * context for the ScanFact payload. Every string field below also passes
 * through {@link redactSecrets} as a defense in case gitleaks failed to
 * honor `--redact`.
 *
 * Renamed from `GitleaksFinding` in step 05b to make the boundary
 * explicit: this is parser output, NOT a `Finding`. Finding emission
 * lives in the assertion layer (step 09b–12b), not in scanners.
 */
export interface GitleaksMatch {
  readonly ruleId: string;
  readonly filePath: string;
  readonly line: number;
  readonly description: string;
  readonly fingerprint: string;
  /**
   * Gitleaks-redacted `Match` (under --redact). Optional because some
   * gitleaks versions omit it. Never contains a raw secret value.
   */
  readonly redactedMatch?: string;
  /**
   * Byte range from gitleaks `StartColumn` / `EndColumn`. Optional —
   * not all gitleaks versions emit columns.
   */
  readonly byteRange?: { readonly start: number; readonly end: number };
}

/**
 * Pre-revision alias kept until 08b (tool-runner migration) removes the
 * `findings` field from `GitleaksOutput`. Consumers that still read the
 * old shape can stay on this name; new code should use `GitleaksMatch`.
 */
export type GitleaksFinding = GitleaksMatch;

/**
 * Output of {@link runGitleaks} on a successful run.
 *
 * `findings` is the pre-revision shape consumed today by the tool-runner
 * agent (step 08). `facts` is the revision §3.1 + §9 step-05-row shape:
 * generic `ScanFact[]` records that downstream assertion predicates
 * (step 09b–12b) consume. Step 08b will switch tool-runner to read
 * `facts` and remove `findings`; until then the adapter dual-emits.
 */
export interface GitleaksOutput {
  readonly findings: readonly GitleaksMatch[];
  readonly facts: readonly ScanFact[];
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
