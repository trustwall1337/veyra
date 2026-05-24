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
