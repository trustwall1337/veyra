import type {
  ScannerExecutionError,
  ScannerNotInstalledError,
  ScannerOutputParseError,
} from '../../types/errors.js';
import type { ScanFact } from '../../types/scan-fact.js';

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
 * Normalized OSV finding, one per (package, vulnerability) pair.
 *
 * **Step 06b**: scanner-side assertion-layer classification fields
 * (`findingType`, `evidenceStrength`, `reviewAction`) were removed. The
 * authoritative classification lives in the tool-runner agent's
 * `CLASSIFICATION` map (`src/agents/tool-runner/tool-runner.ts`),
 * which is consulted at finding-emission time. Scanner adapters now
 * emit pure observation: what package, what advisory id, where.
 */
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
}

/**
 * Output of {@link runOsv} on a successful run.
 *
 * `findings` is the pre-revision shape consumed today by the tool-runner
 * agent (step 08). `facts` is the revision §3.1 + §9 step-06-row shape:
 * generic `ScanFact[]` records that downstream assertion predicates
 * (cc-11-10 in step 09b–12b) consume. Step 08b aggregates these facts
 * into `scan-facts.json` without transformation; the adapter return
 * shape IS the artifact shape.
 */
export interface OsvOutput {
  readonly findings: readonly OsvFinding[];
  readonly facts: readonly ScanFact[];
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
