export class PolicyViolationError extends Error {
  override readonly name = 'PolicyViolationError';
  public readonly action: string;
  public readonly serviceId: string | undefined;

  constructor(message: string, action: string, serviceId?: string) {
    super(message);
    this.action = action;
    this.serviceId = serviceId;
  }
}

export class RedactionError extends Error {
  override readonly name = 'RedactionError';
  constructor(message: string) {
    super(message);
  }
}

export class ScannerNotInstalledError extends Error {
  override readonly name = 'ScannerNotInstalledError';
  public readonly scannerName: string;
  public readonly suggestion: string | undefined;

  constructor(scannerName: string, suggestion?: string) {
    super(`Scanner not installed: ${scannerName}`);
    this.scannerName = scannerName;
    this.suggestion = suggestion;
  }
}

/**
 * Scanner output could not be parsed as the expected JSON shape.
 *
 * Used by per-scanner adapters under `src/scanners/<name>/` when the
 * upstream binary emits stdout that is not valid JSON, or whose JSON
 * shape does not match the documented contract.
 *
 * The `scannerName` field carries the adapter id so `src/types/` stays free
 * of hardcoded provider names (per `FPP §2A`).
 */
export class ScannerOutputParseError extends Error {
  override readonly name = 'ScannerOutputParseError';
  public readonly scannerName: string;

  constructor(scannerName: string, message: string, options?: ErrorOptions) {
    super(`${scannerName}: ${message}`, options);
    this.scannerName = scannerName;
  }
}

/**
 * Scanner subprocess failed in a way that isn't "binary missing" or
 * "bad JSON" — e.g. unexpected exit code, killed by timeout, killed by
 * signal.
 */
export class ScannerExecutionError extends Error {
  override readonly name = 'ScannerExecutionError';
  public readonly scannerName: string;

  constructor(scannerName: string, message: string, options?: ErrorOptions) {
    super(`${scannerName}: ${message}`, options);
    this.scannerName = scannerName;
  }
}
