import type {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';
import type { ScanFact } from '../../types/scan-fact.js';

/** Input to {@link runSemgrep}. */
export interface SemgrepInput {
  /** Absolute path to the project root to scan. */
  readonly projectPath: string;
  /**
   * Absolute path to the rules directory (e.g. `<repo>/rules/`). Veyra
   * always uses its own bundled rules — no `--config p/<registry-bundle>`,
   * no `--config auto`. The adapter refuses to read rules from a network
   * or registry source.
   */
  readonly rulesPath: string;
  /** Override default subprocess timeout (120s — semgrep can be slow). */
  readonly timeoutMs?: number;
}

export type SemgrepSeverity = 'INFO' | 'WARNING' | 'ERROR';

/**
 * Normalized Semgrep finding. Carries the rule id, file location, message,
 * and the rule's declared `severity`. The adapter intentionally does NOT
 * carry a `findingType` (`likely_issue` / `confirmed_issue`) — per step 07
 * Guardrails, rule severity maps to evidence strength, and the consuming
 * agent (step 08 + step 10 / 11) decides classification.
 */
export interface SemgrepFinding {
  readonly ruleId: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly message: string;
  readonly severity: SemgrepSeverity;
  /**
   * Byte offsets from `start.offset` / `end.offset` in the semgrep JSON
   * (semgrep ≥ 1.x emits these). Optional because older versions or
   * specific rule kinds may omit them.
   */
  readonly startOffset?: number;
  readonly endOffset?: number;
  /**
   * Matched source lines as captured by semgrep (`extra.lines`).
   * Optional. Used for ScanFact `sanitized_excerpt` after 02c
   * sanitization; never read raw by AI prompts.
   */
  readonly lines?: string;
}

/**
 * Output of {@link runSemgrep} on a successful run.
 *
 * `findings` is the pre-revision shape consumed by tool-runner (step 08).
 * `facts` is the revision §3.1 + §9 step-07 row shape: generic
 * `ScanFact[]` records with `payload.rule_id` populated so downstream
 * predicates (cc-11-1 through cc-11-7) dispatch on the rule. Step 08b
 * removes `findings`; until then the adapter dual-emits.
 */
export interface SemgrepOutput {
  readonly findings: readonly SemgrepFinding[];
  readonly facts: readonly ScanFact[];
  /**
   * Non-fatal errors the scanner emitted (e.g. a rule failed to parse,
   * a file couldn't be read). Surfacing these lets the tool-runner agent
   * report `coverage_gap` rather than silent absence.
   */
  readonly nonFatalErrors: readonly string[];
}

/** Union of every typed failure mode the adapter can return. */
export type SemgrepError =
  | ScannerNotInstalledError
  | ScannerOutputParseError
  | ScannerExecutionError;

/**
 * Raw subprocess result. The adapter parses `stdout` for findings;
 * `stderr` is captured for auditability but not part of the normalized
 * output — the tool-runner agent (step 08) decides whether to persist it.
 *
 * `exitCode === null` means the process did not exit normally (killed by
 * signal — typically the spawn `timeout` option). The adapter maps that
 * to `ScannerExecutionError` rather than treating it as a clean run.
 */
export interface SemgrepRunnerResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface SemgrepRunnerOptions {
  readonly timeoutMs: number;
}

/**
 * Pluggable subprocess shim. Tests inject a fake; the default implementation
 * shells out to the real `semgrep` binary via `node:child_process.spawn`.
 */
export type SemgrepRunner = (
  binary: string,
  args: readonly string[],
  opts: SemgrepRunnerOptions,
) => Promise<SemgrepRunnerResult>;
